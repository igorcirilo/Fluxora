import { describe, expect, it } from "vitest";
import { addMonthsClamped, openCents, splitInstallments, titleStatus } from "@/modules/finance/titles";
import { createTitles, settleTitle, importHistoricalRevenue, addMovement, reverseMovement } from "@/modules/finance/ops";
import { dasNominalDueDate, dasSchedule, dasnDueDate } from "@/modules/mei/calendar";
import { applyTransition, canTransition, DisabledFiscalProvider } from "@/modules/fiscal/provider";
import { DisabledBillingProvider } from "@/modules/billing/provider";
import { whatsappLink } from "@/modules/customers/customer";
import { ACCOUNT_BANK } from "@/modules/tenants/state";
import { ctx, tenantState } from "./helpers";

describe("títulos e liquidações parciais", () => {
  it("parcelas: resto de centavos na primeira; vencimentos mensais com fim de mês ajustado", () => {
    expect(splitInstallments(1000, 3)).toEqual([334, 333, 333]);
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("liquidação parcial → parcial; total → liquidado; acima do saldo é rejeitada", () => {
    const c = ctx();
    let s = createTitles(tenantState(), { kind: "payable", description: "Fornecedor", competenceDate: "2026-11-01", firstDueDate: "2026-12-05", totalCents: 10_000, installments: 2 }, c);
    expect(s.titles).toHaveLength(2);
    const t = s.titles[0]!;
    s = settleTitle(s, { titleId: t.id, amountCents: 2000, date: "2026-11-26", accountId: ACCOUNT_BANK }, c);
    const t1 = s.titles.find((x) => x.id === t.id)!;
    expect(titleStatus(t1, "2026-11-26")).toBe("parcial");
    expect(openCents(t1)).toBe(3000);
    expect(() => settleTitle(s, { titleId: t.id, amountCents: 3001, date: "2026-11-26", accountId: ACCOUNT_BANK }, c)).toThrow(/saldo/);
    s = settleTitle(s, { titleId: t.id, amountCents: 3000, date: "2026-11-26", accountId: ACCOUNT_BANK }, c);
    expect(titleStatus(s.titles.find((x) => x.id === t.id)!, "2026-11-26")).toBe("liquidado");
    expect(s.movements.filter((m) => m.category === "payable_settlement")).toHaveLength(2);
    expect(titleStatus(s.titles[1]!, "2027-02-01")).toBe("vencido");
  });

  it("lançamentos manuais: aporte/empréstimo não são receita; estorno ligado", () => {
    const c = ctx();
    let s = addMovement(tenantState(), { accountId: ACCOUNT_BANK, date: "2026-11-02", direction: "in", amountCents: 50_000, category: "capital_contribution", description: "Aporte" }, c);
    expect(s.revenues).toHaveLength(0);
    expect(() => addMovement(s, { accountId: ACCOUNT_BANK, date: "2026-11-02", direction: "in", amountCents: 1, category: "expense", description: "x" }, c)).toThrow(/Direção/);
    s = addMovement(s, { accountId: ACCOUNT_BANK, date: "2026-11-02", direction: "out", amountCents: 900, category: "expense", description: "Embalagens" }, c);
    s = reverseMovement(s, s.movements[1]!.id, c);
    expect(s.movements[2]).toMatchObject({ category: "reversal", direction: "in", reversalOf: s.movements[1]!.id });
    expect(() => reverseMovement(s, s.movements[1]!.id, c)).toThrow();
  });

  it("importação histórica respeita data de abertura", () => {
    const c = ctx();
    expect(() => importHistoricalRevenue(tenantState(), { competenceDate: "2024-01-01", amountCents: 100, description: "" }, c)).toThrow(/abertura/);
    expect(importHistoricalRevenue(tenantState(), { competenceDate: "2026-01-01", amountCents: 100, description: "" }, c).revenues).toHaveLength(1);
  });
});

describe("calendário MEI", () => {
  it("DAS vence nominalmente dia 20 do mês seguinte; dezembro vira janeiro", () => {
    expect(dasNominalDueDate(2026, 11)).toBe("2026-12-20");
    expect(dasNominalDueDate(2026, 12)).toBe("2027-01-20");
    expect(dasnDueDate(2026)).toBe("2027-05-31");
  });

  it("agenda a partir do mês de abertura, marca fim de semana e não presume pagamento", () => {
    const sch = dasSchedule({ year: 2026, openedOn: "2026-09-15", today: "2026-11-26", payments: [{ competence: "2026-09", amountCents: 8_000, paidOn: "2026-10-19" }] });
    expect(sch.map((x) => x.competence)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(sch.map((x) => x.status)).toEqual(["pago", "vencido", "pendente", "futuro"]);
    expect(sch.find((x) => x.competence === "2026-11")!.dueOnWeekend).toBe(true); // 20/12/2026 é domingo
  });
});

describe("integrações sem credenciais", () => {
  it("fiscal desabilitado nunca simula sucesso", async () => {
    await expect(new DisabledFiscalProvider().issue()).rejects.toMatchObject({ code: "FISCAL_PROVIDER_NOT_CONFIGURED" });
    await expect(new DisabledBillingProvider().createCheckout()).rejects.toMatchObject({ code: "BILLING_PROVIDER_NOT_CONFIGURED" });
    expect(await new DisabledBillingProvider().verifyWebhook()).toBe(false);
  });

  it("máquina de estados fiscal: autorização só com protocolo; cancelado é terminal", () => {
    expect(canTransition("draft", "authorized")).toBe(false);
    expect(() => applyTransition("submitted", { to: "authorized", at: "x" })).toThrow(/protocolo/);
    expect(applyTransition("submitted", { to: "authorized", at: "x", protocol: "123" })).toBe("authorized");
    expect(canTransition("cancelled", "draft")).toBe(false);
    expect(canTransition("unknown", "authorized")).toBe(true);
  });

  it("WhatsApp por link iniciado pelo usuário", () => {
    expect(whatsappLink("(81) 99999-0000", "Olá")).toBe("https://wa.me/5581999990000?text=Ol%C3%A1");
    expect(whatsappLink("123", "x")).toBeNull();
  });
});
