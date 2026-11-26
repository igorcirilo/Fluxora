import { DomainError } from "@/lib/errors";
import { audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import type { FiscalDocType, FiscalDocument } from "./provider";

/** Cria somente um RASCUNHO interno. Envio exige provedor homologado (desabilitado por padrão). */
export function createFiscalDraft(state: TenantState, input: { saleId: string; type: FiscalDocType }, ctx: Ctx): TenantState {
  const sale = state.sales.find((s) => s.id === input.saleId);
  if (!sale) throw new DomainError("SALE_NOT_FOUND", "Venda não encontrada.");
  if (sale.status !== "concluida") throw new DomainError("VALIDATION_ERROR", "Venda devolvida não gera documento fiscal.");
  if (state.fiscalDocuments.some((d) => d.saleId === sale.id && d.status !== "cancelled" && d.status !== "rejected")) {
    throw new DomainError("VALIDATION_ERROR", "Já existe documento fiscal para esta venda.");
  }
  const doc: FiscalDocument = {
    id: ctx.newId("fdc"),
    type: input.type,
    saleId: sale.id,
    status: "draft",
    createdAt: ctx.nowIso,
    events: [{ to: "draft", at: ctx.nowIso, message: "Rascunho criado" }],
  };
  return { ...state, fiscalDocuments: [...state.fiscalDocuments, doc], audit: [...state.audit, audit(state, ctx, "fiscal.draft", "fiscal_document", doc.id, input.type)] };
}

export function discardFiscalDraft(state: TenantState, id: string, ctx: Ctx): TenantState {
  const doc = state.fiscalDocuments.find((d) => d.id === id);
  if (!doc || doc.status !== "draft") throw new DomainError("VALIDATION_ERROR", "Somente rascunhos podem ser descartados.");
  return {
    ...state,
    fiscalDocuments: state.fiscalDocuments.map((d) => (d.id === id ? { ...d, status: "cancelled", events: [...d.events, { to: "cancelled", at: ctx.nowIso, message: "Rascunho descartado" }] } : d)),
    audit: [...state.audit, audit(state, ctx, "fiscal.discard", "fiscal_document", id)],
  };
}
