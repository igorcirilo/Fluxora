import { makeBizDate, parts, weekday, compareBiz, type BizDate } from "@/modules/finance/dates";
import type { Cents } from "@/modules/finance/money";

/**
 * Calendário de obrigações MEI (versão "calendar-v1").
 * - DAS: vencimento NOMINAL dia 20 do mês seguinte à competência.
 * - DASN-SIMEI: vencimento NOMINAL 31 de maio do ano seguinte.
 * Quando a data nominal cai em fim de semana sinalizamos para conferência no PGMEI/portal oficial;
 * NÃO inventamos a regra de ajuste (feriados locais/nacionais variam).
 */
export const CALENDAR_VERSION = "calendar-v1";

export type DasStatus = "pendente" | "pago" | "vencido" | "futuro";

export interface DasPaymentRecord {
  competence: string; // YYYY-MM
  amountCents: Cents;
  paidOn: BizDate;
  proofNote?: string; // referência ao comprovante; nunca presumir pagamento por clique
}

export interface DasObligation {
  competence: string;
  nominalDueDate: BizDate;
  dueOnWeekend: boolean;
  status: DasStatus;
  payment?: DasPaymentRecord;
}

export function dasNominalDueDate(year: number, month: number): BizDate {
  return month === 12 ? makeBizDate(year + 1, 1, 20) : makeBizDate(year, month + 1, 20);
}

export function competenceKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function dasSchedule(params: { year: number; openedOn: BizDate; today: BizDate; payments: readonly DasPaymentRecord[] }): DasObligation[] {
  const { year, openedOn, today, payments } = params;
  const o = parts(openedOn);
  if (o.year > year) return [];
  const first = o.year === year ? o.month : 1;
  const out: DasObligation[] = [];
  for (let m = first; m <= 12; m++) {
    const competence = competenceKey(year, m);
    const due = dasNominalDueDate(year, m);
    const wd = weekday(due);
    const payment = payments.find((p) => p.competence === competence);
    const competenceStarted = compareBiz(makeBizDate(year, m, 1), today) <= 0;
    let status: DasStatus;
    if (payment) status = "pago";
    else if (!competenceStarted) status = "futuro";
    else if (compareBiz(today, due) > 0) status = "vencido";
    else status = "pendente";
    out.push({ competence, nominalDueDate: due, dueOnWeekend: wd === 0 || wd === 6, status, payment });
  }
  return out;
}

export function dasnDueDate(baseYear: number): BizDate {
  return makeBizDate(baseYear + 1, 5, 31);
}
