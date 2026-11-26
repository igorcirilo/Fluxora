import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "@/modules/finance/money";
import { makeTransfer } from "@/modules/finance/cash";
import { ACCOUNT_BANK, ACCOUNT_DRAWER, audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import { openCashSession } from "./checkout";

/** Saldo esperado na gaveta: contagem de abertura + movimentos da sessão. */
export function expectedDrawer(state: TenantState, sessionId: string): Cents {
  const s = state.cashSessions.find((x) => x.id === sessionId);
  if (!s) return 0;
  let total = s.openingCountCents;
  for (const m of state.movements) {
    if (m.sessionId !== sessionId) continue;
    total += m.direction === "in" ? m.amountCents : -m.amountCents;
  }
  return total;
}

export function openSession(state: TenantState, openingCountCents: Cents, ctx: Ctx): TenantState {
  if (openCashSession(state)) throw new DomainError("CASH_SESSION_ALREADY_OPEN", "Já existe um caixa aberto.");
  if (!Number.isSafeInteger(openingCountCents) || openingCountCents < 0) throw new DomainError("INVALID_AMOUNT", "Valor de abertura inválido.");
  const id = ctx.newId("cxs");
  return {
    ...state,
    cashSessions: [...state.cashSessions, { id, openedAt: ctx.nowIso, openedOn: ctx.today, openingCountCents }],
    audit: [...state.audit, audit(state, ctx, "cash_session.open", "cash_session", id, String(openingCountCents))],
  };
}

/** Sangria (gaveta → banco) ou suprimento (banco → gaveta): transferências, não receita/despesa. */
export function drawerTransfer(state: TenantState, kind: "sangria" | "suprimento", amountCents: Cents, ctx: Ctx, note?: string): TenantState {
  const session = openCashSession(state);
  if (!session) throw new DomainError("CASH_SESSION_CLOSED", "Abra o caixa primeiro.");
  assertCents(amountCents);
  if (kind === "sangria" && amountCents > expectedDrawer(state, session.id)) {
    throw new DomainError("SETTLEMENT_EXCEEDS_BALANCE", "Sangria maior que o saldo da gaveta.");
  }
  const id = ctx.newId("trf");
  const [out, inn] = makeTransfer({
    id,
    fromAccountId: kind === "sangria" ? ACCOUNT_DRAWER : ACCOUNT_BANK,
    toAccountId: kind === "sangria" ? ACCOUNT_BANK : ACCOUNT_DRAWER,
    date: ctx.today,
    amountCents,
    description: note?.trim() || (kind === "sangria" ? "Sangria do caixa" : "Suprimento do caixa"),
  });
  const tag = (m: typeof out) => (m.accountId === ACCOUNT_DRAWER ? { ...m, sessionId: session.id } : m);
  return {
    ...state,
    movements: [...state.movements, tag(out), tag(inn)],
    audit: [...state.audit, audit(state, ctx, `cash_session.${kind}`, "cash_session", session.id, String(amountCents))],
  };
}

export function closeSession(state: TenantState, countedCents: Cents, ctx: Ctx): TenantState {
  const session = openCashSession(state);
  if (!session) throw new DomainError("CASH_SESSION_CLOSED", "Nenhum caixa aberto.");
  if (!Number.isSafeInteger(countedCents) || countedCents < 0) throw new DomainError("INVALID_AMOUNT", "Valor contado inválido.");
  const expected = expectedDrawer(state, session.id);
  return {
    ...state,
    cashSessions: state.cashSessions.map((s) => (s.id === session.id ? { ...s, closedAt: ctx.nowIso, countedCents, expectedCents: expected, differenceCents: countedCents - expected } : s)),
    audit: [...state.audit, audit(state, ctx, "cash_session.close", "cash_session", session.id, `contado ${countedCents} esperado ${expected}`)],
  };
}
