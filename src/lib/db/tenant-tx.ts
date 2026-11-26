import type { Pool, PoolClient } from "pg";
import { DomainError } from "@/lib/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Executa `fn` numa transação com o contexto do tenant:
 * 1. define app.user_id (usuário já autenticado pela camada de auth);
 * 2. VERIFICA membership (RLS de memberships só mostra linhas do próprio usuário);
 * 3. só então define app.tenant_id com set_config(..., true) — escopo LOCAL à transação,
 *    portanto o contexto nunca vaza para a próxima requisição que reutilizar a conexão do pool.
 * Nunca confie em tenant recebido do cliente sem este fluxo.
 */
export async function withTenant<T>(pool: Pool, ctx: { userId: string; tenantId: string }, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.userId) || !UUID.test(ctx.tenantId)) throw new DomainError("TENANT_ACCESS_DENIED", "Contexto inválido.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    const m = await client.query("SELECT role FROM app.memberships WHERE tenant_id = $1 AND user_id = $2", [ctx.tenantId, ctx.userId]);
    if (m.rowCount !== 1) throw new DomainError("TENANT_ACCESS_DENIED", "Acesso negado a esta empresa.");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Contexto apenas de usuário (ex.: listar empresas do usuário, onboarding). */
export async function withUser<T>(pool: Pool, userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new DomainError("TENANT_ACCESS_DENIED", "Contexto inválido.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
