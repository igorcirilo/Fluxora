import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "./money";
import { compareBiz, type BizDate } from "./dates";

/**
 * Títulos (contas a receber / a pagar). Separam competência, vencimento e liquidação.
 * Liquidações parciais são permitidas; nunca acima do saldo em aberto.
 */
export type TitleKind = "receivable" | "payable";
export type TitleStatus = "aberto" | "parcial" | "liquidado" | "vencido" | "cancelado";

export interface Settlement {
  id: string;
  date: BizDate;
  amountCents: Cents;
  accountId: string;
  movementId: string;
}

export interface Title {
  id: string;
  kind: TitleKind;
  description: string;
  counterpartyId?: string; // cliente ou fornecedor
  competenceDate: BizDate;
  dueDate: BizDate;
  amountCents: Cents;
  installment?: { number: number; of: number; groupId: string };
  category?: string;
  sourceId?: string; // ex.: venda fiado
  settlements: Settlement[];
  cancelledAt?: string;
}

export function settledCents(t: Title): Cents {
  return t.settlements.reduce((s, x) => s + x.amountCents, 0);
}

export function openCents(t: Title): Cents {
  return t.cancelledAt ? 0 : t.amountCents - settledCents(t);
}

export function titleStatus(t: Title, today: BizDate): TitleStatus {
  if (t.cancelledAt) return "cancelado";
  const open = openCents(t);
  if (open === 0) return "liquidado";
  if (compareBiz(today, t.dueDate) > 0) return "vencido";
  return settledCents(t) > 0 ? "parcial" : "aberto";
}

export function settle(t: Title, s: Settlement): Title {
  assertCents(s.amountCents);
  if (t.cancelledAt) throw new DomainError("SETTLEMENT_EXCEEDS_BALANCE", "Título cancelado.");
  if (s.amountCents > openCents(t)) throw new DomainError("SETTLEMENT_EXCEEDS_BALANCE", "Valor maior que o saldo em aberto.");
  return { ...t, settlements: [...t.settlements, s] };
}

/** Divide um valor em N parcelas mensais; o resto de centavos vai para a primeira parcela. */
export function splitInstallments(totalCents: Cents, count: number): Cents[] {
  assertCents(totalCents);
  if (!Number.isInteger(count) || count < 1 || count > 48) throw new DomainError("INVALID_QUANTITY", "Parcelas entre 1 e 48.");
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? rest : 0));
}

export function addMonthsClamped(date: BizDate, months: number): BizDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
