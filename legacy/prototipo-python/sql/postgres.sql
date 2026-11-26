-- Run as migration owner; runtime role must not own tables or have BYPASSRLS.
CREATE TABLE tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,opened date NOT NULL);
CREATE TABLE memberships(tenant_id uuid REFERENCES tenants(id),user_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('owner','operator','accountant')),PRIMARY KEY(tenant_id,user_id));
CREATE TABLE entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),kind text NOT NULL CHECK(kind IN ('sale','receipt','expense')),day date NOT NULL,description text NOT NULL,amount bigint NOT NULL CHECK(amount>0),UNIQUE(tenant_id,id));
CREATE INDEX ON entries(tenant_id,day);
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_entries ON entries USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
-- Trusted backend verifies membership before SET LOCAL app.tenant_id in each transaction.
