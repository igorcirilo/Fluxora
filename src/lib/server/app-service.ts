import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { DomainError } from "@/lib/errors";
import { getPool, isDatabaseConfigured } from "@/lib/db/pool";
import { withTenant, withUser } from "@/lib/db/tenant-tx";
import { loadTenantState, persistDiff } from "@/lib/db/tenant-repo";
import { getSessionUser } from "@/lib/auth/server";
import { runCommand } from "@/modules/commands";
import { todayBiz } from "@/modules/finance/dates";
import type { Ctx } from "@/modules/tenants/state";

export const TENANT_COOKIE = "fluxora_tenant";

export function serverCtx(userId: string, now = new Date()): Ctx {
  return { nowIso: now.toISOString(), today: todayBiz(now), actor: userId, newId: (p) => `${p}_${randomUUID()}` };
}

/** Usuário autenticado (Better Auth). Sem sessão ⇒ 403 com código estável. */
export async function requireUser() {
  if (!isDatabaseConfigured()) throw new DomainError("TENANT_ACCESS_DENIED", "Contas reais não estão habilitadas.");
  const user = await getSessionUser(await headers());
  if (!user) throw new DomainError("TENANT_ACCESS_DENIED", "Sessão expirada. Entre novamente.");
  return user;
}

export interface TenantSummary {
  id: string;
  tradeName: string;
  role: string;
}

export async function listTenants(userId: string): Promise<TenantSummary[]> {
  return withUser(getPool(), userId, async (c) => (await c.query('SELECT t.id, t.trade_name AS "tradeName", m.role FROM app.memberships m JOIN app.tenants t ON t.id = m.tenant_id WHERE m.user_id = $1 ORDER BY t.created_at', [userId])).rows);
}

/** Empresa ativa: o cookie é só uma preferência; a membership é sempre verificada no withTenant. */
export async function activeTenantId(userId: string): Promise<string | null> {
  const preferred = (await cookies()).get(TENANT_COOKIE)?.value;
  const tenants = await listTenants(userId);
  return tenants.find((t) => t.id === preferred)?.id ?? tenants[0]?.id ?? null;
}

export async function createTenant(userId: string, input: { name: string; tradeName: string; openedOn: string; segment: string }): Promise<string> {
  return withUser(getPool(), userId, async (c) => (await c.query("SELECT app.create_tenant($1, $2, $3::date, $4) AS id", [input.name, input.tradeName, input.openedOn, input.segment])).rows[0].id);
}

export async function loadState(userId: string, tenantId: string) {
  return withTenant(getPool(), { userId, tenantId }, (c) => loadTenantState(c, tenantId));
}

/**
 * Executa um comando como transação: trava a empresa (serializa escritas concorrentes),
 * carrega o estado sob RLS, roda o domínio puro e grava só a diferença. Falha ⇒ ROLLBACK total.
 */
export async function executeCommand(userId: string, tenantId: string, name: string, input: unknown) {
  return withTenant(getPool(), { userId, tenantId }, async (c) => {
    const role = (await c.query("SELECT role FROM app.memberships WHERE tenant_id = $1 AND user_id = $2", [tenantId, userId])).rows[0]?.role;
    if (role === "accountant") throw new DomainError("TENANT_ACCESS_DENIED", "Acesso de contador é somente leitura.");
    await c.query("SELECT 1 FROM app.tenants WHERE id = $1 FOR UPDATE", [tenantId]);
    const before = await loadTenantState(c, tenantId);
    const out = runCommand(name, input, before, serverCtx(userId));
    await persistDiff(c, before, out.state);
    return out;
  });
}

/** CSRF nas rotas JSON próprias: exige Origin igual ao host atendido (ou origem confiável configurada). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const trusted = [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",")].map((s) => s?.trim()).filter(Boolean);
  let ok = false;
  try {
    if (origin) {
      const u = new URL(origin);
      ok = u.host === host || trusted.includes(u.origin);
    }
  } catch {
    ok = false;
  }
  if (!ok) throw new DomainError("TENANT_ACCESS_DENIED", "Origem não permitida.");
}

/* ---------- Contador ---------- */

export interface PendingInvite {
  tenantId: string;
  linkId: string;
  companyLabel: string;
  scopes: string[];
  grantedAt: string;
  expiresAt: string;
}

export async function pendingInvites(userId: string): Promise<PendingInvite[]> {
  return withUser(getPool(), userId, async (c) =>
    (await c.query("SELECT * FROM app.pending_accountant_invites()")).rows.map((r) => ({
      tenantId: r.tenant_id,
      linkId: r.link_id,
      companyLabel: r.company_label,
      scopes: r.scopes,
      grantedAt: new Date(r.granted_at).toISOString(),
      expiresAt: new Date(r.invite_expires_at).toISOString(),
    })),
  );
}

/** Aceite: e-mail do usuário precisa ser o convidado E o código precisa conferir (5 tentativas). */
export async function acceptInvite(userId: string, tenantId: string, linkId: string, code: string): Promise<string> {
  return withUser(getPool(), userId, async (c) => (await c.query("SELECT app.accept_accountant_invite($1::uuid, $2, $3) AS r", [tenantId, linkId, code])).rows[0].r as string);
}

/** Escopos do vínculo do contador em cada empresa (somente vínculos aceitos e não revogados). */
export async function accountantScopes(userId: string): Promise<Map<string, string[]>> {
  return withUser(getPool(), userId, async (c) => {
    const rows = (await c.query("SELECT tenant_id, scopes FROM app.accountant_links WHERE accountant_user_id = $1 AND revoked_at IS NULL", [userId])).rows;
    return new Map(rows.map((r) => [r.tenant_id as string, r.scopes as string[]]));
  });
}
