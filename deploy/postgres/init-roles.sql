-- Executado UMA vez pelo superusuário ao provisionar o banco (ex.: docker-entrypoint-initdb.d).
-- Senhas vêm de variáveis/segredos do ambiente — nunca versionadas.
-- Uso: psql -v owner_pw="..." -v app_pw="..." -f init-roles.sql
CREATE ROLE fluxora_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE fluxora_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE DATABASE fluxora OWNER fluxora_owner;
\connect fluxora
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CREATE, USAGE ON SCHEMA public TO fluxora_owner;
