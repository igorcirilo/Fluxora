import { DomainError } from "@/lib/errors";
import { basisPoints, type Cents } from "@/modules/finance/money";
import { compareBiz, parts, type BizDate } from "@/modules/finance/dates";
import { resolveRule, type MeiRegime, type TaxRule } from "./rules";
import type { RevenueEntry } from "./revenue";

export type LimitStatus =
  | "sem_atividade"
  | "normal"
  | "monitorar" // >= 80%
  | "atencao" // >= 90%
  | "limite_atingido" // == 100%
  | "excesso_ate_20" // > 100% e <= 120%
  | "excesso_acima_20"; // > 120%

export const LIMIT_STATUS_LABEL: Record<LimitStatus, string> = {
  sem_atividade: "Sem atividade no ano",
  normal: "Dentro do limite",
  monitorar: "Monitorar (80%)",
  atencao: "Atenção (90%)",
  limite_atingido: "Limite atingido",
  excesso_ate_20: "Excesso de até 20%",
  excesso_acima_20: "Excesso superior a 20%",
};

export interface LimitReport {
  year: number;
  ruleId: string;
  activeMonths: number;
  limitCents: Cents;
  grossCents: Cents;
  reversalsCents: Cents;
  remainingCents: Cents;
  usedBp: number;
  status: LimitStatus;
}

/** Meses de atividade no ano: proporcional no ano de abertura, incluindo o mês de abertura. */
export function activeMonths(openedOn: BizDate, year: number): number {
  const o = parts(openedOn);
  if (o.year > year) return 0;
  if (o.year === year) return 13 - o.month;
  return 12;
}

export function classify(grossCents: Cents, limitCents: Cents, rule: Pick<TaxRule, "excessToleranceBp">): LimitStatus {
  if (limitCents <= 0) return "sem_atividade";
  // Comparações inteiras exatas (sem float), equivalentes ao protótipo Python.
  const tol = 10_000 + rule.excessToleranceBp; // 12000 = 120%
  if (grossCents * 10_000 > limitCents * tol) return "excesso_acima_20";
  if (grossCents > limitCents) return "excesso_ate_20";
  if (grossCents === limitCents) return "limite_atingido";
  if (grossCents * 10 >= limitCents * 9) return "atencao";
  if (grossCents * 5 >= limitCents * 4) return "monitorar";
  return "normal";
}

/**
 * Receita bruta do ano por competência, a partir da data de abertura.
 * Estornos reduzem a receita somente se ligados a um original existente e sem exceder o saldo dele.
 */
export function grossRevenue(entries: readonly RevenueEntry[], openedOn: BizDate, year: number): { gross: Cents; reversals: Cents } {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const reversedSoFar = new Map<string, number>();
  let gross = 0;
  let reversals = 0;
  for (const e of entries) {
    if (e.kind === "reversal") continue;
    const { year: y } = parts(e.competenceDate);
    if (y === year && compareBiz(e.competenceDate, openedOn) >= 0) gross += e.amountCents;
  }
  for (const e of entries) {
    if (e.kind !== "reversal") continue;
    const original = e.reversalOf ? byId.get(e.reversalOf) : undefined;
    if (!original || original.kind === "reversal") {
      throw new DomainError("REVERSAL_ORIGINAL_NOT_FOUND", "Estorno sem lançamento original válido.");
    }
    const already = reversedSoFar.get(original.id) ?? 0;
    if (already + e.amountCents > original.amountCents) {
      throw new DomainError("REVERSAL_EXCEEDS_ORIGINAL", "Estorno excede o valor do lançamento original.");
    }
    reversedSoFar.set(original.id, already + e.amountCents);
    // O estorno afeta a competência do lançamento original.
    const { year: y } = parts(original.competenceDate);
    if (y === year && compareBiz(original.competenceDate, openedOn) >= 0) reversals += e.amountCents;
  }
  return { gross: gross - reversals, reversals };
}

export function limitReport(params: { entries: readonly RevenueEntry[]; openedOn: BizDate; year: number; regime?: MeiRegime; rules?: readonly TaxRule[] }): LimitReport {
  const { entries, openedOn, year, regime = "mei-geral" } = params;
  const rule = resolveRule(regime, year, params.rules);
  const months = activeMonths(openedOn, year);
  const limitCents = Math.floor((rule.annualLimitCents * months) / 12);
  const { gross, reversals } = grossRevenue(entries, openedOn, year);
  return {
    year,
    ruleId: rule.id,
    activeMonths: months,
    limitCents,
    grossCents: gross,
    reversalsCents: reversals,
    remainingCents: limitCents - gross,
    usedBp: basisPoints(gross, limitCents),
    status: classify(gross, limitCents, rule),
  };
}

export interface LimitProjection {
  monthlyAverageCents: Cents;
  projectedAnnualCents: Cents;
  projectedStatus: LimitStatus;
  /** Mês (1-12) em que a projeção atinge o limite, se ocorrer no ano. */
  breachMonth: number | null;
  elapsedMonths: number;
}

/**
 * Projeção linear gerencial: média mensal dos meses decorridos de atividade × meses ativos.
 * Não é previsão fiscal; serve apenas para alertar com antecedência.
 */
export function projectLimit(report: LimitReport, asOf: BizDate, openedOn: BizDate, rule: Pick<TaxRule, "excessToleranceBp">): LimitProjection {
  const a = parts(asOf);
  const o = parts(openedOn);
  const firstMonth = o.year === report.year ? o.month : 1;
  let lastMonth: number;
  if (a.year > report.year) lastMonth = 12;
  else if (a.year < report.year) lastMonth = firstMonth - 1;
  else lastMonth = a.month;
  const elapsed = Math.max(0, lastMonth - firstMonth + 1);
  if (elapsed === 0 || report.activeMonths === 0) {
    return { monthlyAverageCents: 0, projectedAnnualCents: report.grossCents, projectedStatus: report.status, breachMonth: null, elapsedMonths: 0 };
  }
  const avg = Math.floor(report.grossCents / elapsed);
  const projected = report.grossCents + avg * (report.activeMonths - elapsed);
  let breachMonth: number | null = null;
  if (avg > 0 && report.limitCents > 0) {
    if (report.grossCents >= report.limitCents) breachMonth = lastMonth;
    else {
      const monthsToBreach = Math.ceil((report.limitCents - report.grossCents) / avg);
      const m = lastMonth + monthsToBreach;
      breachMonth = m <= 12 ? m : null;
    }
  }
  return { monthlyAverageCents: avg, projectedAnnualCents: projected, projectedStatus: classify(projected, report.limitCents, rule), breachMonth, elapsedMonths: elapsed };
}

/** Receita por mês (1..12) do ano, líquida de estornos (para gráficos e relatório mensal). */
export function monthlyRevenue(entries: readonly RevenueEntry[], year: number): Cents[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const months = Array.from({ length: 12 }, () => 0);
  for (const e of entries) {
    const ref = e.kind === "reversal" ? byId.get(e.reversalOf ?? "") : e;
    if (!ref) continue;
    const p = parts(ref.competenceDate);
    if (p.year !== year) continue;
    months[p.month - 1]! += e.kind === "reversal" ? -e.amountCents : e.amountCents;
  }
  return months;
}
