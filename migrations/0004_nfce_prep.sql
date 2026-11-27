-- Preparação da NFC-e (piloto SP): dados fiscais do produto e configuração fiscal por empresa.
-- Segredos (certificado A1, CSC) NUNCA ficam aqui: apenas indicadores de que foram configurados no provedor.
ALTER TABLE app.products
  ADD COLUMN ncm char(8) CHECK (ncm ~ '^[0-9]{8}$'),
  ADD COLUMN cfop char(4) CHECK (cfop ~ '^[1-7][0-9]{3}$'),
  ADD COLUMN csosn char(3) CHECK (csosn IN ('102', '103', '300', '400', '500', '900')),
  ADD COLUMN origem char(1) CHECK (origem ~ '^[0-8]$'),
  ADD COLUMN cest char(7) CHECK (cest ~ '^[0-9]{7}$');

CREATE TABLE app.fiscal_settings (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),
  uf char(2) NOT NULL DEFAULT 'SP' CHECK (uf = 'SP'),
  ie text CHECK (ie ~ '^[0-9]{12}$'),
  environment text NOT NULL DEFAULT 'homologacao' CHECK (environment IN ('homologacao', 'producao')),
  series int NOT NULL DEFAULT 1 CHECK (series BETWEEN 1 AND 999),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 999999999),
  crt char(1) CHECK (crt IN ('1', '2', '3', '4')),
  accreditation_confirmed_at timestamptz,
  certificate_configured boolean NOT NULL DEFAULT false,
  csc_configured boolean NOT NULL DEFAULT false,
  accountant_review_name text CHECK (length(accountant_review_name) <= 120),
  accountant_review_at timestamptz,
  accountant_review_note text CHECK (length(accountant_review_note) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Produção somente com revisão do contador registrada.
  CHECK (environment = 'homologacao' OR accountant_review_at IS NOT NULL)
);

ALTER TABLE app.fiscal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fiscal_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.fiscal_settings
  USING (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id))
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id));

GRANT SELECT, INSERT, UPDATE ON app.fiscal_settings TO fluxora_app;
