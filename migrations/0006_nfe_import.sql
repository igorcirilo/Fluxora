-- Importação do XML da NF-e de compra: CNPJ do fornecedor e vínculo "código do item no fornecedor → produto".

ALTER TABLE app.suppliers ADD COLUMN document text CHECK (document ~ '^(\d{11}|\d{14})$');
CREATE UNIQUE INDEX suppliers_document_uniq ON app.suppliers (tenant_id, document) WHERE document IS NOT NULL;

CREATE TABLE app.supplier_item_links (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  supplier_id text NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  product_id text NOT NULL,
  factor int NOT NULL DEFAULT 1 CHECK (factor BETWEEN 1 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, supplier_id, code),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES app.suppliers (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES app.products (tenant_id, id)
);

ALTER TABLE app.supplier_item_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.supplier_item_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.supplier_item_links FOR SELECT USING (tenant_id = app.current_tenant_id() AND app.is_member(tenant_id));
CREATE POLICY tenant_insert ON app.supplier_item_links FOR INSERT WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id));
CREATE POLICY tenant_update ON app.supplier_item_links FOR UPDATE USING (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id)) WITH CHECK (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id));
CREATE POLICY tenant_delete ON app.supplier_item_links FOR DELETE USING (tenant_id = app.current_tenant_id() AND app.can_write(tenant_id));
GRANT SELECT, INSERT, UPDATE ON app.supplier_item_links TO fluxora_app;
