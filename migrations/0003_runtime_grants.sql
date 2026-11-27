-- Privilégios mínimos do papel de runtime. O papel é criado fora das migrations
-- (deploy/postgres/init-roles.sql) com NOSUPERUSER NOBYPASSRLS e sem propriedade das tabelas.
GRANT USAGE ON SCHEMA app TO fluxora_app;
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_user_id(), app.is_member(uuid), app.create_tenant(text, text, date, text) TO fluxora_app;
GRANT SELECT ON app.tax_rules TO fluxora_app;
GRANT SELECT ON app.tenants, app.memberships TO fluxora_app;
GRANT UPDATE (name, trade_name, opened_on, segment, city, uf, allow_negative_stock) ON app.tenants TO fluxora_app;
GRANT SELECT, INSERT, UPDATE ON app.accounts, app.customers, app.suppliers, app.products, app.cash_sessions, app.sales, app.titles, app.tax_obligations, app.fiscal_documents, app.accountant_links TO fluxora_app;
GRANT SELECT, INSERT ON app.sale_items, app.payments, app.stock_movements, app.revenue_entries, app.ledger_entries, app.settlements, app.fiscal_events, app.idempotency_keys, app.audit_logs TO fluxora_app;
-- webhook_events/jobs: acessados pelo worker dedicado, não pelo runtime de tenant.
-- Autenticação (Better Auth): o servidor web gerencia usuários, sessões e limites de tentativa.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.auth_user, app.auth_session, app.auth_account, app.auth_verification, app.auth_two_factor, app.auth_rate_limit TO fluxora_app;
