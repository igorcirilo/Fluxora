import type { Cents } from "./money";
import type { CashMovement } from "./cash";
import type { RevenueEntry } from "@/modules/mei/revenue";
import { compareBiz, type BizDate } from "./dates";

/**
 * DRE gerencial simplificada (competência para receita, custo pelas vendas, despesas por caixa).
 * É gerencial: não substitui escrituração contábil.
 */
export interface SimpleDre {
  grossRevenueCents: Cents;
  reversalsCents: Cents;
  netRevenueCents: Cents;
  cogsCents: Cents; // custo das mercadorias vendidas (estimado pelo custo cadastrado)
  grossProfitCents: Cents;
  expensesCents: Cents;
  feesCents: Cents;
  operatingResultCents: Cents;
  /** Margem em pontos-base sobre a receita líquida. */
  marginBp: number;
}

export function simpleDre(params: { revenues: readonly RevenueEntry[]; cogsCents: Cents; movements: readonly CashMovement[]; start: BizDate; end: BizDate }): SimpleDre {
  const { revenues, movements, start, end, cogsCents } = params;
  const inRange = (d: BizDate) => compareBiz(d, start) >= 0 && compareBiz(d, end) < 0;
  const byId = new Map(revenues.map((r) => [r.id, r]));
  let gross = 0;
  let reversals = 0;
  for (const r of revenues) {
    if (r.kind === "reversal") {
      const o = byId.get(r.reversalOf ?? "");
      if (o && inRange(o.competenceDate)) reversals += r.amountCents;
    } else if (inRange(r.competenceDate) && r.kind !== "historical_import") gross += r.amountCents;
  }
  let expenses = 0;
  let fees = 0;
  for (const m of movements) {
    if (!inRange(m.date) || m.direction !== "out") continue;
    if (m.category === "expense" || m.category === "payable_settlement") expenses += m.amountCents;
    if (m.category === "fee") fees += m.amountCents;
  }
  const net = gross - reversals;
  const grossProfit = net - cogsCents;
  const operating = grossProfit - expenses - fees;
  return {
    grossRevenueCents: gross,
    reversalsCents: reversals,
    netRevenueCents: net,
    cogsCents,
    grossProfitCents: grossProfit,
    expensesCents: expenses,
    feesCents: fees,
    operatingResultCents: operating,
    marginBp: net > 0 ? Math.floor((operating * 10_000) / net) : 0,
  };
}
