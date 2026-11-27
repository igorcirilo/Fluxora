import { DomainError } from "@/lib/errors";
import { audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import { DEFAULT_FISCAL_SETTINGS, normalizeFiscalSettings, type FiscalSettings } from "./nfce";

export function fiscalSettingsOf(state: TenantState): FiscalSettings {
  return state.fiscal ?? DEFAULT_FISCAL_SETTINGS;
}

export function updateFiscalSettings(
  state: TenantState,
  input: Pick<FiscalSettings, "ie" | "environment" | "series" | "nextNumber" | "crt"> & { accreditationConfirmed: boolean; certificateConfigured: boolean; cscConfigured: boolean },
  ctx: Ctx,
): TenantState {
  const current = fiscalSettingsOf(state);
  const { accreditationConfirmed, ...rest } = input;
  const next = normalizeFiscalSettings({ ...rest, accreditationConfirmedAt: accreditationConfirmed ? (current.accreditationConfirmedAt ?? ctx.nowIso) : undefined }, current);
  return { ...state, fiscal: next, audit: [...state.audit, audit(state, ctx, "fiscal.settings", "fiscal_settings", state.tenant.id, `${next.environment} série ${next.series}`)] };
}

/** Revisão do contador registrada com nome e data (auditada). Revogar volta para homologação. */
export function setAccountantReview(state: TenantState, input: { name: string; note?: string; confirmed: boolean }, ctx: Ctx): TenantState {
  const current = fiscalSettingsOf(state);
  if (input.confirmed) {
    const name = input.name.trim();
    if (name.length < 2) throw new DomainError("VALIDATION_ERROR", "Informe o nome do contador responsável.");
    const next: FiscalSettings = { ...current, accountantReview: { name, at: ctx.nowIso, note: input.note?.trim() || undefined } };
    return { ...state, fiscal: next, audit: [...state.audit, audit(state, ctx, "fiscal.review", "fiscal_settings", state.tenant.id, name)] };
  }
  const next: FiscalSettings = { ...current, environment: "homologacao" };
  delete next.accountantReview;
  return { ...state, fiscal: next, audit: [...state.audit, audit(state, ctx, "fiscal.review.revoke", "fiscal_settings", state.tenant.id)] };
}
