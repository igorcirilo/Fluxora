import { DomainError } from "@/lib/errors";
import { assertBizDate } from "@/modules/finance/dates";
import { audit, type Ctx, type Tenant, type TenantState } from "./state";
import { revokeLink, type AccountantLink, type AccountantScope } from "@/modules/accounting/links";

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

export function grantAccountant(state: TenantState, input: { accountantName: string; firm: string; email: string; scopes: AccountantScope[] }, ctx: Ctx): TenantState {
  if (input.accountantName.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) throw new DomainError("VALIDATION_ERROR", "Informe nome e e-mail válidos do contador.");
  if (!input.scopes.includes("read")) throw new DomainError("VALIDATION_ERROR", "O vínculo precisa ao menos de leitura.");
  const link: AccountantLink = {
    id: ctx.newId("lnk"),
    accountantName: input.accountantName.trim(),
    firm: input.firm.trim(),
    email: input.email.trim().toLowerCase(),
    scopes: input.scopes,
    grantedAt: ctx.nowIso,
  };
  return { ...state, accountantLinks: [...state.accountantLinks, link], audit: [...state.audit, audit(state, ctx, "accountant.grant", "accountant_link", link.id, input.scopes.join(","))] };
}

export function revokeAccountant(state: TenantState, id: string, ctx: Ctx): TenantState {
  if (!state.accountantLinks.some((l) => l.id === id)) throw new DomainError("VALIDATION_ERROR", "Vínculo não encontrado.");
  return {
    ...state,
    accountantLinks: state.accountantLinks.map((l) => (l.id === id ? revokeLink(l, ctx.nowIso) : l)),
    audit: [...state.audit, audit(state, ctx, "accountant.revoke", "accountant_link", id)],
  };
}
