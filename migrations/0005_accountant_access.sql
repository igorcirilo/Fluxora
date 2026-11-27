-- Acesso do contador: convite com código de uso único, leitura apenas, revogação imediata.

-- 1) Quem pode ESCREVER: titular ou operador. Contador só lê (defesa em profundidade além do app).
CREATE FUNCTION app.can_write(t uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM app.memberships m WHERE m.tenant_id = t AND m.user_id = app.current_user_id() AND m.role IN ('owner', 'operator')) $$;
GRANT EXECUTE ON FUNCTION app.can_write(uuid) TO fluxora_app;

CREATE FUNCTION app.current_user_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$ SELECT lower(email) FROM app.auth_user WHERE id = app.current_user_id() $$;
GRANT EXECUTE ON FUNCTION app.current_user_email() TO fluxora_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','customers','suppliers','products','cash_sessions','sales','sale_items','payments','stock_movements','revenue_entries','ledger_entries','titles','settlements','tax_obligations','fiscal_documents','fiscal_events','accountant_links','idempotency_keys','audit_logs','fiscal_settings']
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON app.%I', t);
    EXECUTE format('CREATE POLICY tenant_read ON app.%I FOR SELECT USING (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id))', t);
    EXECUTE format('CREATE POLICY tenant_insert ON app.%I FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id))', t);
    EXECUTE format('CREATE POLICY tenant_update ON app.%I FOR UPDATE USING (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id)) WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id))', t);
    EXECUTE format('CREATE POLICY tenant_delete ON app.%I FOR DELETE USING (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id))', t);
  END LOOP;
END $$;

DROP POLICY tenants_update ON app.tenants;
CREATE POLICY tenants_update ON app.tenants FOR UPDATE USING (app.can_write(id)) WITH CHECK (app.can_write(id));

-- 2) Convite: código de uso único, validade e limite de tentativas. Nome da empresa como rótulo do convite.
ALTER TABLE app.accountant_links
  ADD COLUMN company_label text NOT NULL DEFAULT '' CHECK (length(company_label) <= 80),
  ADD COLUMN invite_code text CHECK (invite_code ~ '^[A-Z0-9]{8}$'),
  ADD COLUMN invite_expires_at timestamptz,
  ADD COLUMN invite_failed_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN accepted_at timestamptz;

-- O código nunca é LIDO pelo runtime: privilégios por coluna. Ele é gravado no INSERT do convite e mostrado só ao titular na criação.
REVOKE SELECT, UPDATE ON app.accountant_links FROM fluxora_app;
GRANT SELECT (tenant_id, id, accountant_user_id, accountant_name, firm, email, scopes, granted_at, revoked_at, company_label, invite_expires_at, accepted_at) ON app.accountant_links TO fluxora_app;
GRANT UPDATE (revoked_at) ON app.accountant_links TO fluxora_app;

-- O convidado enxerga apenas convites pendentes endereçados ao próprio e-mail (sem ser membro da empresa).
CREATE POLICY links_invitee_read ON app.accountant_links FOR SELECT
  USING (lower(email) = app.current_user_email() AND revoked_at IS NULL AND accepted_at IS NULL);
CREATE POLICY links_invitee_update ON app.accountant_links FOR UPDATE
  USING (lower(email) = app.current_user_email() AND revoked_at IS NULL)
  WITH CHECK (lower(email) = app.current_user_email());

-- Contador também enxerga o próprio vínculo aceito (para saber escopos), sem precisar de contexto de empresa.
CREATE POLICY links_accountant_read ON app.accountant_links FOR SELECT USING (accountant_user_id = app.current_user_id());

-- 3) Membership de contador: inserida só pela função de aceite; removida na revogação.
-- memberships deixa de FORÇAR RLS para o dono da tabela: assim as funções SECURITY DEFINER
-- (create_tenant, aceite e revogação) administram vínculos de outros usuários. O runtime continua
-- sujeito ao RLS (só vê as próprias memberships) e não tem INSERT/UPDATE/DELETE nesta tabela.
ALTER TABLE app.memberships NO FORCE ROW LEVEL SECURITY;

CREATE FUNCTION app.accept_accountant_invite(p_tenant uuid, p_link text, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_user uuid := app.current_user_id(); l record;
BEGIN
  IF v_user IS NULL THEN RETURN 'unauthenticated'; END IF;
  SELECT * INTO l FROM app.accountant_links WHERE tenant_id = p_tenant AND id = p_link FOR UPDATE;
  IF NOT FOUND OR l.accepted_at IS NOT NULL OR l.revoked_at IS NOT NULL THEN RETURN 'not_found'; END IF;
  IF l.invite_expires_at IS NULL OR l.invite_expires_at <= now() THEN RETURN 'expired'; END IF;
  IF l.invite_failed_attempts >= 5 THEN RETURN 'locked'; END IF;
  IF l.invite_code IS NULL OR upper(trim(p_code)) <> l.invite_code THEN
    UPDATE app.accountant_links SET invite_failed_attempts = invite_failed_attempts + 1 WHERE tenant_id = p_tenant AND id = p_link;
    RETURN CASE WHEN l.invite_failed_attempts + 1 >= 5 THEN 'locked' ELSE 'invalid_code' END;
  END IF;
  UPDATE app.accountant_links SET accountant_user_id = v_user, accepted_at = now(), invite_code = NULL WHERE tenant_id = p_tenant AND id = p_link;
  INSERT INTO app.memberships (tenant_id, user_id, role) VALUES (p_tenant, v_user, 'accountant') ON CONFLICT (tenant_id, user_id) DO NOTHING;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION app.accept_accountant_invite(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_accountant_invite(uuid, text, text) TO fluxora_app;

-- Revogar remove o acesso imediatamente.
CREATE FUNCTION app.on_accountant_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND NEW.accountant_user_id IS NOT NULL THEN
    DELETE FROM app.memberships WHERE tenant_id = NEW.tenant_id AND user_id = NEW.accountant_user_id AND role = 'accountant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accountant_links_revoke AFTER UPDATE OF revoked_at ON app.accountant_links FOR EACH ROW EXECUTE FUNCTION app.on_accountant_revoke();

-- Lista de convites pendentes do usuário atual (sem expor o código).
CREATE FUNCTION app.pending_accountant_invites() RETURNS TABLE (tenant_id uuid, link_id text, company_label text, accountant_name text, scopes text[], granted_at timestamptz, invite_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT l.tenant_id, l.id, l.company_label, l.accountant_name, l.scopes, l.granted_at, l.invite_expires_at
    FROM app.accountant_links l
   WHERE lower(l.email) = app.current_user_email() AND l.revoked_at IS NULL AND l.accepted_at IS NULL AND l.invite_expires_at > now()
   ORDER BY l.granted_at DESC
$$;
REVOKE ALL ON FUNCTION app.pending_accountant_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pending_accountant_invites() TO fluxora_app;
