import { Pool } from "pg";

let pool: Pool | null = null;

/** Pool do papel de RUNTIME (sem BYPASSRLS, sem propriedade das tabelas). */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL não configurada (modo demo não usa banco).");
    pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, application_name: "fluxora-web" });
  }
  return pool;
}
