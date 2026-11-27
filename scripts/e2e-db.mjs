// Prepara um banco PostgreSQL descartável para o E2E do modo conta.
// Uso: TEST_PG_ADMIN_URL=postgres://postgres:...@host:5432/postgres node scripts/e2e-db.mjs fluxora_e2e
// Imprime DATABASE_URL do papel de runtime (sem segredos reais: senha de teste fixa).
import pg from "pg";
import { migrate } from "./migrate.mjs";

const admin = new pg.Client({ connectionString: process.env.TEST_PG_ADMIN_URL });
const name = process.argv[2] ?? "fluxora_e2e";
const url = (user, db) => {
  const u = new URL(process.env.TEST_PG_ADMIN_URL);
  u.username = user;
  u.password = "test";
  u.pathname = `/${db}`;
  return u.toString();
};
await admin.connect();
for (const [role, extra] of [["fluxora_owner", "CREATEDB"], ["fluxora_app", ""]]) {
  const r = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (!r.rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS ${extra}`);
}
await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${name} OWNER fluxora_owner`);
await admin.end();
const owner = new pg.Client({ connectionString: url("fluxora_owner", name) });
await owner.connect();
await migrate(owner, undefined, () => undefined);
await owner.end();
console.log(url("fluxora_app", name));
