import type { Cents } from "@/modules/finance/money";
import type { BizDate } from "@/modules/finance/dates";

/**
 * Lançamento de receita bruta por COMPETÊNCIA (independe do recebimento).
 * - sale/service: venda de mercadoria ou prestação de serviço.
 * - historical_import: faturamento anterior ao uso do app (importação de histórico).
 * - reversal: estorno/cancelamento ligado ao lançamento original (`reversalOf`).
 * Transferências, aportes e empréstimos NUNCA são receita e não existem neste tipo.
 */
export type RevenueKind = "sale" | "service" | "historical_import" | "reversal";

export interface RevenueEntry {
  id: string;
  kind: RevenueKind;
  competenceDate: BizDate;
  amountCents: Cents;
  description: string;
  reversalOf?: string;
  sourceId?: string; // ex.: id da venda
}
