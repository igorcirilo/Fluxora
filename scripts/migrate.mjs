// Executor de migrations SQL portável (PostgreSQL). Uso: DATABASE_URL_MIGRATOR=... node scripts/migrate.mjs
// Cada arquivo roda em transação própria; checksum impede alteração silenciosa de migration aplicada.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "..", "migrations");

/** @param {import("pg").Client} client */
export async function migrate(client, dir = MIGRATIONS_DIR, log = console.log) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map((await client.query("SELECT name, checksum FROM public.schema_migrations")).rows.map((r) => [r.name, r.checksum]));
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const done = [];
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const sum = createHash("sha256").update(sql).digest("hex");
    if (applied.has(file)) {
      if (applied.get(file) !== sum) throw new Error(`Migration ${file} foi alterada após aplicada (checksum diferente).`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)", [file, sum]);
      await client.query("COMMIT");
      done.push(file);
      log(`✓ ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`Falha em ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) {
    console.error("Defina DATABASE_URL_MIGRATOR (papel proprietário).");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const done = await migrate(client);
    console.log(done.length ? `${done.length} migration(s) aplicada(s).` : "Banco já atualizado.");
  } finally {
    await client.end();
  }
}
