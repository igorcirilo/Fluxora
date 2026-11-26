import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "./money";
import { compareBiz, monthStart, nextMonthStart, type BizDate } from "./dates";

/**
 * Movimento de caixa REALIZADO (liquidação). Fluxo de caixa = saldo inicial + recebimentos − pagamentos.
 * Venda a prazo entra no faturamento (competência) e só entra aqui quando liquidada.
 */
export type CashCategory =
  | "opening_balance" // saldo inicial da conta
  | "sale_receipt" // recebimento à vista de venda
  | "receivable_settlement" // liquidação (total/parcial) de conta a receber
  | "other_income" // outras entradas operacionais
  | "expense" // despesa paga à vista
  | "payable_settlement" // liquidação de conta a pagar
  | "fee" // taxas (maquininha, banco)
  | "owner_withdrawal" // retirada do titular (não é despesa operacional)
  | "capital_contribution" // aporte do titular (não é receita)
  | "loan" // empréstimo recebido (não é receita)
  | "transfer" // transferência entre contas (sangria/suprimento incluídos)
  | "refund" // devolução de valor ao cliente
  | "reversal"; // estorno de movimento lançado por engano

export type Direction = "in" | "out";

export interface CashMovement {
  id: string;
  accountId: string;
  date: BizDate; // data da liquidação
  direction: Direction;
  amountCents: Cents;
  category: CashCategory;
  description: string;
  transferId?: string; // liga as duas pernas de uma transferência
  reversalOf?: string;
  sourceId?: string; // venda, título etc.
  sessionId?: string; // sessão de caixa (gaveta) a que pertence
}

export interface CashAccount {
  id: string;
  name: string;
  kind: "cash_drawer" | "bank" | "digital_wallet";
}

export interface CashReport {
  start: BizDate;
  end: BizDate; // exclusivo
  openingCents: Cents;
  incomingCents: Cents;
  outgoingCents: Cents;
  balanceCents: Cents;
  byCategory: Partial<Record<CashCategory, { in: Cents; out: Cents }>>;
}

function signed(m: CashMovement): Cents {
  return m.direction === "in" ? m.amountCents : -m.amountCents;
}

/**
 * Relatório de caixa para [start, end). Com `accountId`, considera só a conta (transferências contam);
 * sem conta (consolidado), transferências se anulam e não aparecem como entrada/saída.
 * Saldo inicial lançado no período é somado à abertura, nunca ao "recebido".
 */
export function cashReport(movements: readonly CashMovement[], start: BizDate, end: BizDate, accountId?: string): CashReport {
  let opening = 0;
  let incoming = 0;
  let outgoing = 0;
  const byCategory: CashReport["byCategory"] = {};
  for (const m of movements) {
    if (accountId && m.accountId !== accountId) continue;
    if (compareBiz(m.date, end) >= 0) continue;
    const isBefore = compareBiz(m.date, start) < 0;
    if (isBefore || m.category === "opening_balance") {
      opening += signed(m);
      continue;
    }
    if (!accountId && m.category === "transfer") continue;
    const bucket = (byCategory[m.category] ??= { in: 0, out: 0 });
    if (m.direction === "in") {
      incoming += m.amountCents;
      bucket.in += m.amountCents;
    } else {
      outgoing += m.amountCents;
      bucket.out += m.amountCents;
    }
  }
  return { start, end, openingCents: opening, incomingCents: incoming, outgoingCents: outgoing, balanceCents: opening + incoming - outgoing, byCategory };
}

export function monthlyCashReport(movements: readonly CashMovement[], year: number, month: number, accountId?: string): CashReport {
  return cashReport(movements, monthStart(year, month), nextMonthStart(year, month), accountId);
}

export function accountBalance(movements: readonly CashMovement[], accountId: string, asOfExclusive?: BizDate): Cents {
  let b = 0;
  for (const m of movements) {
    if (m.accountId !== accountId) continue;
    if (asOfExclusive && compareBiz(m.date, asOfExclusive) >= 0) continue;
    b += signed(m);
  }
  return b;
}

/** Cria as duas pernas de uma transferência; o consolidado não muda. */
export function makeTransfer(params: { id: string; fromAccountId: string; toAccountId: string; date: BizDate; amountCents: Cents; description: string }): [CashMovement, CashMovement] {
  if (params.fromAccountId === params.toAccountId) throw new DomainError("TRANSFER_SAME_ACCOUNT", "Origem e destino devem ser diferentes.");
  assertCents(params.amountCents);
  const base = { date: params.date, amountCents: params.amountCents, category: "transfer" as const, description: params.description, transferId: params.id };
  return [
    { ...base, id: `${params.id}:out`, accountId: params.fromAccountId, direction: "out" },
    { ...base, id: `${params.id}:in`, accountId: params.toAccountId, direction: "in" },
  ];
}

/** Estorno sempre referencia o original e inverte a direção; nunca apagamos histórico. */
export function makeReversal(original: CashMovement, id: string, date: BizDate, existing: readonly CashMovement[]): CashMovement {
  const already = existing.filter((m) => m.reversalOf === original.id).reduce((s, m) => s + m.amountCents, 0);
  if (already >= original.amountCents) throw new DomainError("REVERSAL_EXCEEDS_ORIGINAL", "Movimento já estornado.");
  return {
    id,
    accountId: original.accountId,
    date,
    direction: original.direction === "in" ? "out" : "in",
    amountCents: original.amountCents - already,
    category: "reversal",
    description: `Estorno: ${original.description}`,
    reversalOf: original.id,
  };
}
