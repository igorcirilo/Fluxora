-- Fluxora — schema núcleo multi-tenant.
-- Executar SOMENTE com o papel proprietário (migrator). O papel de runtime (fluxora_app)
-- não é dono das tabelas, não tem BYPASSRLS e recebe apenas os privilégios mínimos.
-- Valores monetários: bigint em centavos. Datas comerciais: date (America/Sao_Paulo). Timestamps: timestamptz (UTC).

CREATE SCHEMA IF NOT EXISTS app;

-- Contexto da requisição, definido por transação (set_config(..., true)) após verificação de membership.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Bloqueia UPDATE/DELETE em tabelas de histórico imutável (correções = novos lançamentos de estorno/ajuste).
CREATE FUNCTION app.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'tabela % é imutável: registre estorno/ajuste', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;

-- ---------- Identidade ----------
CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text, -- Argon2id/scrypt via biblioteca de autenticação; nunca texto puro
  mfa_enabled boolean NOT NULL DEFAULT false,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, -- apenas hash do token
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.sessions (user_id);

-- ---------- Tenancy ----------
CREATE TABLE app.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
  trade_name text NOT NULL CHECK (length(trade_name) BETWEEN 1 AND 80),
  opened_on date NOT NULL,
  regime text NOT NULL DEFAULT 'mei-geral' CHECK (regime IN ('mei-geral', 'mei-caminhoneiro')),
  segment text NOT NULL DEFAULT 'comercio' CHECK (segment IN ('comercio', 'servicos', 'misto')),
  city text NOT NULL DEFAULT '',
  uf char(2),
  allow_negative_stock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'operator', 'accountant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX ON app.memberships (user_id);

-- Membership do usuário corrente no tenant corrente (defesa em profundidade nas políticas).
CREATE FUNCTION app.is_member(t uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM app.memberships m WHERE m.tenant_id = t AND m.user_id = app.current_user_id()) $$;

-- ---------- Regras fiscais versionadas (globais, somente leitura para o runtime) ----------
CREATE TABLE app.tax_rules (
  id text PRIMARY KEY,
  regime text NOT NULL,
  valid_from int NOT NULL,
  valid_to int,
  annual_limit_cents bigint NOT NULL CHECK (annual_limit_cents > 0),
  excess_tolerance_bp int NOT NULL CHECK (excess_tolerance_bp >= 0),
  alert_thresholds_bp int[] NOT NULL,
  reference text NOT NULL,
  reviewed_at date NOT NULL,
  requires_accountant_review boolean NOT NULL DEFAULT true,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
INSERT INTO app.tax_rules VALUES
  ('mei-geral-v1', 'mei-geral', 2018, NULL, 8100000, 2000, '{8000,9000,10000}', 'Documentação Fluxora v0.1, seção 3 (LC 123/2006 — confirmar redação vigente)', '2026-11-26', true);

-- ---------- Negócio (todas com tenant_id NOT NULL, UNIQUE (tenant_id, id) para FKs compostas) ----------
CREATE TABLE app.accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash_drawer', 'bank', 'digital_wallet')),
  UNIQUE (tenant_id, id)
);

CREATE TABLE app.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  phone text CHECK (phone ~ '^[0-9]{10,13}$'),
  email text,
  notes text CHECK (length(notes) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ON app.customers (tenant_id, name);

CREATE TABLE app.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE app.products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9-]{2,30}$'),
  barcode text CHECK (barcode ~ '^[0-9]{8,14}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT 'Geral',
  unit text NOT NULL CHECK (unit IN ('un', 'kg', 'cx', 'pct', 'h')),
  price_cents bigint NOT NULL CHECK (price_cents > 0),
  cost_cents bigint NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  min_stock int NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  track_stock boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE app.cash_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_on date NOT NULL,
  opening_count_cents bigint NOT NULL CHECK (opening_count_cents >= 0),
  closed_at timestamptz,
  counted_cents bigint,
  expected_cents bigint,
  UNIQUE (tenant_id, id)
);
-- No máximo um caixa aberto por tenant.
CREATE UNIQUE INDEX cash_sessions_one_open ON app.cash_sessions (tenant_id) WHERE closed_at IS NULL;

CREATE TABLE app.sales (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  number int NOT NULL,
  idempotency_key text NOT NULL,
  sale_date date NOT NULL,
  customer_id uuid,
  cash_session_id uuid,
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents > 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0 AND discount_cents < subtotal_cents),
  total_cents bigint NOT NULL CHECK (total_cents = subtotal_cents - discount_cents),
  cash_tendered_cents bigint NOT NULL DEFAULT 0,
  change_cents bigint NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  status text NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'devolvida')),
  returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, idempotency_key), -- repetição da requisição não duplica a venda
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES app.cash_sessions (tenant_id, id)
);
CREATE INDEX ON app.sales (tenant_id, sale_date);

CREATE TABLE app.sale_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents = quantity * unit_price_cents),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES app.sales (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES app.products (tenant_id, id)
);
CREATE INDEX ON app.sale_items (tenant_id, sale_id);

CREATE TABLE app.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  sale_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN ('dinheiro', 'pix', 'debito', 'credito', 'fiado')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES app.sales (tenant_id, id)
);

CREATE TABLE app.stock_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  product_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('initial', 'purchase', 'sale', 'return', 'adjustment', 'loss')),
  quantity int NOT NULL CHECK (quantity <> 0),
  movement_date date NOT NULL,
  unit_cost_cents bigint,
  source_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, product_id) REFERENCES app.products (tenant_id, id),
  CHECK ((type IN ('sale', 'loss') AND quantity < 0) OR (type IN ('initial', 'purchase', 'return') AND quantity > 0) OR type = 'adjustment')
);
CREATE INDEX ON app.stock_movements (tenant_id, product_id, movement_date);

-- Receita por competência (base do limite MEI). Estorno referencia o original no mesmo tenant.
CREATE TABLE app.revenue_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  kind text NOT NULL CHECK (kind IN ('sale', 'service', 'historical_import', 'reversal')),
  competence_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  description text NOT NULL,
  reversal_of uuid,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of) REFERENCES app.revenue_entries (tenant_id, id),
  CHECK ((kind = 'reversal') = (reversal_of IS NOT NULL))
);
CREATE INDEX ON app.revenue_entries (tenant_id, competence_date);

-- Movimentos de caixa liquidados (ledger). Transferências ligadas por transfer_id.
CREATE TABLE app.ledger_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  account_id uuid NOT NULL,
  entry_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  category text NOT NULL CHECK (category IN ('opening_balance', 'sale_receipt', 'receivable_settlement', 'other_income', 'expense', 'payable_settlement', 'fee', 'owner_withdrawal', 'capital_contribution', 'loan', 'transfer', 'refund', 'reversal')),
  description text NOT NULL,
  transfer_id uuid,
  reversal_of uuid,
  source_id uuid,
  cash_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES app.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of) REFERENCES app.ledger_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_session_id) REFERENCES app.cash_sessions (tenant_id, id),
  CHECK ((category = 'transfer') = (transfer_id IS NOT NULL))
);
CREATE INDEX ON app.ledger_entries (tenant_id, entry_date);

-- Contas a receber / a pagar (competência, vencimento e liquidação separados).
CREATE TABLE app.titles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  kind text NOT NULL CHECK (kind IN ('receivable', 'payable')),
  description text NOT NULL,
  customer_id uuid,
  supplier_id uuid,
  competence_date date NOT NULL,
  due_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  installment_group uuid,
  installment_number int,
  installment_count int,
  category text,
  source_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES app.customers (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES app.suppliers (tenant_id, id)
);
CREATE INDEX ON app.titles (tenant_id, kind, due_date);

CREATE TABLE app.settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  title_id uuid NOT NULL,
  settled_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  ledger_entry_id uuid NOT NULL,
  FOREIGN KEY (tenant_id, title_id) REFERENCES app.titles (tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_entry_id) REFERENCES app.ledger_entries (tenant_id, id)
);

-- Impede liquidação acima do saldo do título (inclusive sob concorrência: trava a linha do título).
CREATE FUNCTION app.check_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; settled bigint;
BEGIN
  SELECT amount_cents INTO total FROM app.titles WHERE tenant_id = NEW.tenant_id AND id = NEW.title_id FOR UPDATE;
  SELECT coalesce(sum(amount_cents), 0) INTO settled FROM app.settlements WHERE tenant_id = NEW.tenant_id AND title_id = NEW.title_id;
  IF settled + NEW.amount_cents > total THEN
    RAISE EXCEPTION 'liquidação excede o saldo do título' USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlements_limit BEFORE INSERT ON app.settlements FOR EACH ROW EXECUTE FUNCTION app.check_settlement();

-- Obrigações MEI: pagamentos de DAS registrados manualmente com comprovante.
CREATE TABLE app.tax_obligations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  kind text NOT NULL CHECK (kind IN ('das', 'dasn_simei')),
  competence text NOT NULL CHECK (competence ~ '^[0-9]{4}(-[0-9]{2})?$'),
  amount_cents bigint CHECK (amount_cents > 0),
  paid_on date,
  proof_note text,
  calendar_version text NOT NULL DEFAULT 'calendar-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, competence),
  CHECK (paid_on IS NULL OR (amount_cents IS NOT NULL AND length(proof_note) >= 3))
);

CREATE TABLE app.fiscal_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  type text NOT NULL CHECK (type IN ('nfse', 'nfce', 'nfe')),
  sale_id uuid,
  status text NOT NULL CHECK (status IN ('draft', 'queued', 'submitted', 'authorized', 'rejected', 'cancelled', 'unknown')),
  protocol text,
  provider_ref text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES app.sales (tenant_id, id),
  CHECK (status <> 'authorized' OR protocol IS NOT NULL) -- nunca "autorizado" sem protocolo
);

CREATE TABLE app.fiscal_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  document_id uuid NOT NULL,
  to_status text NOT NULL,
  protocol text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, document_id) REFERENCES app.fiscal_documents (tenant_id, id)
);

CREATE TABLE app.accountant_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  accountant_user_id uuid REFERENCES app.users(id),
  accountant_name text NOT NULL,
  firm text NOT NULL,
  email text NOT NULL,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'export']::text[] AND 'read' = ANY (scopes)),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE app.idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  scope text NOT NULL,
  key text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);

CREATE TABLE app.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  actor_user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  details text, -- sem dados pessoais nem segredos
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.audit_logs (tenant_id, created_at);

-- Webhooks (cobrança/fiscal): globais, deduplicados por provedor+evento. Acesso só pelo worker.
CREATE TABLE app.webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  verified boolean NOT NULL,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- Fila PostgreSQL simples (SKIP LOCKED) com retry exponencial e dead letter.
CREATE TABLE app.jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  dead_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready ON app.jobs (queue, run_at) WHERE dead_at IS NULL AND locked_at IS NULL;

-- ---------- Imutabilidade ----------
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON app.stock_movements FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER revenue_entries_immutable BEFORE UPDATE OR DELETE ON app.revenue_entries FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON app.ledger_entries FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER settlements_immutable BEFORE UPDATE OR DELETE ON app.settlements FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();
CREATE TRIGGER fiscal_events_immutable BEFORE UPDATE OR DELETE ON app.fiscal_events FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---------- Row Level Security (negar por padrão) ----------
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON app.tenants FOR SELECT USING (app.is_member(id));
CREATE POLICY tenants_insert ON app.tenants FOR INSERT WITH CHECK (app.current_user_id() IS NOT NULL);
CREATE POLICY tenants_update ON app.tenants FOR UPDATE USING (app.is_member(id)) WITH CHECK (app.is_member(id));

ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_self ON app.memberships FOR SELECT USING (user_id = app.current_user_id());
CREATE POLICY memberships_insert_self ON app.memberships FOR INSERT WITH CHECK (user_id = app.current_user_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','customers','suppliers','products','cash_sessions','sales','sale_items','payments','stock_movements','revenue_entries','ledger_entries','titles','settlements','tax_obligations','fiscal_documents','fiscal_events','accountant_links','idempotency_keys','audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON app.%I
      USING (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id))
      WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id))$p$, t);
  END LOOP;
END $$;

-- Onboarding: cria empresa + membership de titular + contas padrão para o usuário autenticado corrente.
-- SECURITY DEFINER com search_path fixo; o runtime não tem INSERT direto em tenants/memberships.
CREATE FUNCTION app.create_tenant(p_name text, p_trade_name text, p_opened_on date, p_segment text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_user uuid := app.current_user_id(); v_id uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'usuário não autenticado' USING ERRCODE = '42501'; END IF;
  -- Sem RETURNING: a política de SELECT ainda não vê o tenant antes da membership existir.
  INSERT INTO app.tenants (id, name, trade_name, opened_on, segment) VALUES (v_id, p_name, p_trade_name, p_opened_on, p_segment);
  INSERT INTO app.memberships (tenant_id, user_id, role) VALUES (v_id, v_user, 'owner');
  PERFORM set_config('app.tenant_id', v_id::text, true);
  INSERT INTO app.accounts (tenant_id, name, kind) VALUES (v_id, 'Caixa (gaveta)', 'cash_drawer'), (v_id, 'Conta PJ', 'bank');
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION app.create_tenant(text, text, date, text) FROM PUBLIC;
