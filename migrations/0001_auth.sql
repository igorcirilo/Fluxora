-- Fluxora — tabelas de autenticação (Better Auth 1.7, gerado por scripts/auth-schema.mts).
-- Senhas ficam em auth_account.password como hash scrypt; sessões guardam apenas o token aleatório.
-- Regenerar ao atualizar o Better Auth e revisar o diff antes de aplicar.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app."auth_user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);

CREATE TABLE app."auth_session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references app."auth_user" ("id") on delete cascade);

CREATE TABLE app."auth_account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references app."auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

CREATE TABLE app."auth_verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

CREATE TABLE app."auth_two_factor" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "secret" text not null, "backupCodes" text not null, "userId" uuid not null references app."auth_user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

CREATE TABLE app."auth_rate_limit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

CREATE INDEX "auth_session_userId_idx" ON app."auth_session" ("userId");

CREATE INDEX "auth_account_userId_idx" ON app."auth_account" ("userId");

CREATE INDEX "auth_verification_identifier_idx" ON app."auth_verification" ("identifier");

CREATE INDEX "auth_two_factor_secret_idx" ON app."auth_two_factor" ("secret");

CREATE INDEX "auth_two_factor_userId_idx" ON app."auth_two_factor" ("userId");
