import pg from "pg";
import { migrate } from "../../scripts/migrate.mjs";

export const ADMIN = process.env.TEST_PG_ADMIN_URL;

export function urlFor(user: string, password: string, db: string) {
  const u = new URL(ADMIN!);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

/** Banco descartável com papéis owner/runtime, migrations e dois usuários. */
export async function createTestDb(prefix: string, extraEmails: string[] = []) {
  const name = `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  for (const [role, extra] of [["fluxora_owner", "CREATEDB"], ["fluxora_app", ""]] as const) {
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (!exists.rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS ${extra}`);
  }
  await admin.query(`CREATE DATABASE ${name} OWNER fluxora_owner`);
  const owner = new pg.Client({ connectionString: urlFor("fluxora_owner", "test", name) });
  await owner.connect();
  await migrate(owner, undefined, () => undefined);
  const emails = ["a@exemplo.test", "b@exemplo.test", ...extraEmails];
  const users: { id: string; email: string }[] = [];
  for (const e of emails) users.push((await owner.query(`INSERT INTO app.auth_user (name, email, "emailVerified") VALUES ($1, $2, false) RETURNING id, email`, [e.split("@")[0], e])).rows[0]);
  await owner.end();
  const pool = new pg.Pool({ connectionString: urlFor("fluxora_app", "test", name), max: 2, options: "-c search_path=app,public" });
  return {
    name,
    pool,
    userA: users.find((u) => u.email.startsWith("a@"))!.id,
    userB: users.find((u) => u.email.startsWith("b@"))!.id,
    userByEmail: (e: string) => users.find((u) => u.email === e)!.id,
    adminUrl: ADMIN!,
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
