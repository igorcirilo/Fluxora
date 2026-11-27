import { Pool } from "pg";

let pool: Pool | null = null;

export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Pool do papel de RUNTIME (sem BYPASSRLS, sem propriedade das tabelas).
 * search_path=app para as tabelas do Better Auth (nomes não qualificados).
 * No Neon, use a conexão direta (não "pooler") ou garanta suporte ao parâmetro `options`.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL não configurada.");
    pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 5), idleTimeoutMillis: 20_000, application_name: "fluxora-web", options: "-c search_path=app,public" });
  }
  return pool;
}
