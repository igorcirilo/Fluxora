import { describe, expect, it } from "vitest";
import { accountBalance, cashReport, makeReversal, makeTransfer, monthlyCashReport, type CashMovement } from "@/modules/finance/cash";
import { simpleDre } from "@/modules/finance/dre";

const mv = (id: string, date: string, direction: "in" | "out", amountCents: number, category: CashMovement["category"], accountId = "bank"): CashMovement => ({ id, accountId, date, direction, amountCents, category, description: id });

describe("caixa — porta de engine.cash_report", () => {
  it("saldo = abertura + entradas − saídas (caso do protótipo = 700)", () => {
    const rows = [mv("r", "2026-01-01", "in", 1000, "other_income"), mv("e", "2026-02-01", "out", 300, "expense")];
    const r = monthlyCashReport(rows, 2026, 2);
    expect(r.openingCents).toBe(1000);
    expect(r.outgoingCents).toBe(300);
    expect(r.balanceCents).toBe(700);
  });

  it("dezembro → janeiro (limite exclusivo do período)", () => {
    const rows = [mv("a", "2026-12-31", "in", 100, "other_income"), mv("b", "2027-01-01", "in", 50, "other_income")];
    expect(monthlyCashReport(rows, 2026, 12).incomingCents).toBe(100);
    expect(monthlyCashReport(rows, 2027, 1).openingCents).toBe(100);
  });

  it("saldo inicial lançado no período soma à abertura, não ao recebido", () => {
    const r = monthlyCashReport([mv("s", "2026-05-01", "in", 5000, "opening_balance"), mv("v", "2026-05-02", "in", 100, "sale_receipt")], 2026, 5);
    expect(r.openingCents).toBe(5000);
    expect(r.incomingCents).toBe(100);
  });

  it("transferência não é receita nem despesa no consolidado, mas move saldo das contas", () => {
    const [out, inn] = makeTransfer({ id: "t", fromAccountId: "drawer", toAccountId: "bank", date: "2026-05-10", amountCents: 2000, description: "sangria" });
    const rows = [mv("s", "2026-05-01", "in", 3000, "sale_receipt", "drawer"), out, inn];
    const all = cashReport(rows, "2026-05-01", "2026-06-01");
    expect(all.incomingCents).toBe(3000);
    expect(all.outgoingCents).toBe(0);
    expect(accountBalance(rows, "drawer")).toBe(1000);
    expect(accountBalance(rows, "bank")).toBe(2000);
    expect(cashReport(rows, "2026-05-01", "2026-06-01", "bank").incomingCents).toBe(2000);
    expect(() => makeTransfer({ id: "x", fromAccountId: "a", toAccountId: "a", date: "2026-05-10", amountCents: 1, description: "" })).toThrow();
  });

  it("estorno referencia o original, inverte direção e não pode duplicar", () => {
    const o = mv("o", "2026-05-01", "out", 500, "expense");
    const r = makeReversal(o, "r1", "2026-05-02", [o]);
    expect(r).toMatchObject({ direction: "in", amountCents: 500, reversalOf: "o", category: "reversal" });
    expect(() => makeReversal(o, "r2", "2026-05-03", [o, r])).toThrow();
  });
});

describe("DRE gerencial", () => {
  it("receita líquida, CMV, despesas e margem", () => {
    const dre = simpleDre({
      revenues: [
        { id: "v", kind: "sale", competenceDate: "2026-05-02", amountCents: 10_000, description: "" },
        { id: "h", kind: "historical_import", competenceDate: "2026-05-02", amountCents: 99_999, description: "" },
        { id: "e", kind: "reversal", competenceDate: "2026-05-10", amountCents: 1_000, description: "", reversalOf: "v" },
      ],
      cogsCents: 3_000,
      movements: [mv("d", "2026-05-03", "out", 2_000, "expense"), mv("f", "2026-05-03", "out", 100, "fee"), mv("w", "2026-05-03", "out", 9_999, "owner_withdrawal")],
      start: "2026-05-01",
      end: "2026-06-01",
    });
    expect(dre.netRevenueCents).toBe(9_000);
    expect(dre.grossProfitCents).toBe(6_000);
    expect(dre.operatingResultCents).toBe(3_900);
    expect(dre.marginBp).toBe(4333);
  });
});
