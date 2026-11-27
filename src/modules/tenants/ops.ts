import { DomainError } from "@/lib/errors";
import { assertBizDate } from "@/modules/finance/dates";
import { audit, type Ctx, type Tenant, type TenantState } from "./state";
import { INVITE_TTL_DAYS, inviteCodeFrom, revokeLink, type AccountantLink, type AccountantScope } from "@/modules/accounting/links";

export function updateTenant(state: TenantState, input: Pick<Tenant, "name" | "tradeName" | "openedOn" | "segment" | "city" | "uf" | "allowNegativeStock">, ctx: Ctx): TenantState {
  const tradeName = input.tradeName.trim();
  const name = input.name.trim();
  if (!tradeName || tradeName.length > 80 || !name || name.length > 150) throw new DomainError("VALIDATION_ERROR", "Nome empresarial e fantasia são obrigatórios.");
  assertBizDate(input.openedOn);
  if (input.openedOn > ctx.today) throw new DomainError("INVALID_DATE", "Abertura no futuro.");
  if (input.uf && !/^[A-Z]{2}$/.test(input.uf)) throw new DomainError("VALIDATION_ERROR", "UF inválida.");
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => state.tenant[k] !== input[k]);
  return {
    ...state,
    tenant: { ...state.tenant, ...input, tradeName, name, city: input.city.trim() },
    audit: [...state.audit, audit(state, ctx, "tenant.update", "tenant", state.tenant.id, changed.join(","))],
  };
}

/**
 * Convite ao contador: gera código de uso único (validade de 7 dias). O titular repassa o código
 * por um canal próprio (ex.: WhatsApp); o aceite exige o e-mail convidado E o código.
 */
export function grantAccountant(
  state: TenantState,
  input: { accountantName: string; firm: string; email: string; scopes: AccountantScope[] },
  ctx: Ctx,
): { state: TenantState; value: { linkId: string; code: string; expiresAt: string } } {
  if (input.accountantName.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) throw new DomainError("VALIDATION_ERROR", "Informe nome e e-mail válidos do contador.");
  if (!input.scopes.includes("read")) throw new DomainError("VALIDATION_ERROR", "O vínculo precisa ao menos de leitura.");
  const email = input.email.trim().toLowerCase();
  if (state.accountantLinks.some((l) => l.email === email && !l.revokedAt)) throw new DomainError("VALIDATION_ERROR", "Já existe um vínculo ativo ou pendente para este e-mail.");
  const code = inviteCodeFrom(ctx.newId("inv"));
  const expiresAt = new Date(new Date(ctx.nowIso).getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
  const link: AccountantLink = {
    id: ctx.newId("lnk"),
    accountantName: input.accountantName.trim(),
    firm: input.firm.trim(),
    email,
    scopes: input.scopes,
    grantedAt: ctx.nowIso,
    companyLabel: state.tenant.tradeName.slice(0, 80),
    inviteCode: code,
    inviteExpiresAt: expiresAt,
  };
  return {
    state: { ...state, accountantLinks: [...state.accountantLinks, link], audit: [...state.audit, audit(state, ctx, "accountant.grant", "accountant_link", link.id, input.scopes.join(","))] },
    value: { linkId: link.id, code, expiresAt },
  };
}

export function revokeAccountant(state: TenantState, id: string, ctx: Ctx): TenantState {
  if (!state.accountantLinks.some((l) => l.id === id)) throw new DomainError("VALIDATION_ERROR", "Vínculo não encontrado.");
  return {
    ...state,
    accountantLinks: state.accountantLinks.map((l) => (l.id === id ? revokeLink(l, ctx.nowIso) : l)),
    audit: [...state.audit, audit(state, ctx, "accountant.revoke", "accountant_link", id)],
  };
}
