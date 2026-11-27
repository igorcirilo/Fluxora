// Gera o SQL das tabelas do Better Auth para versionar em migrations/ (executar com um Postgres vazio).
// Uso: AUTH_SCHEMA_DB=postgres://... node scripts/auth-schema.mts > migrations/0001_auth.sql
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/lib/auth/options.ts";

const pool = new pg.Pool({ connectionString: process.env.AUTH_SCHEMA_DB, options: "-c search_path=app" });
const { compileMigrations } = await getMigrations(authOptions(pool, { secret: "x".repeat(32), baseURL: "http://localhost" }));
console.log(await compileMigrations());
await pool.end();
