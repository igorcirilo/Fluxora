-- Privilégios mínimos do papel de runtime. O papel é criado fora das migrations
-- (deploy/postgres/init-roles.sql) com NOSUPERUSER NOBYPASSRLS e sem propriedade das tabelas.
GRANT USAGE ON SCHEMA app TO fluxora_app;
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_user_id(), app.is_member(uuid), app.create_tenant(text, text, date, text) TO fluxora_app;
GRANT SELECT ON app.tax_rules TO fluxora_app;
GRANT SELECT ON app.tenants, app.memberships TO fluxora_app;
GRANT UPDATE (name, trade_name, opened_on, segment, city, uf, allow_negative_stock) ON app.tenants TO fluxora_app;
GRANT SELECT, INSERT, UPDATE ON app.accounts, app.customers, app.suppliers, app.products, app.cash_sessions, app.sales, app.titles, app.tax_obligations, app.fiscal_documents, app.accountant_links TO fluxora_app;
GRANT SELECT, INSERT ON app.sale_items, app.payments, app.stock_movements, app.revenue_entries, app.ledger_entries, app.settlements, app.fiscal_events, app.idempotency_keys, app.audit_logs TO fluxora_app;
-- users/sessions/webhook_events/jobs: acessados por serviços dedicados (auth/worker), não pelo runtime de tenant.
