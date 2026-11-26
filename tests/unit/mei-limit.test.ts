import { describe, expect, it } from "vitest";
import { activeMonths, classify, limitReport, monthlyRevenue, projectLimit } from "@/modules/mei/limit";
import { resolveRule, TAX_RULES } from "@/modules/mei/rules";
import type { RevenueEntry } from "@/modules/mei/revenue";

const sale = (id: string, competenceDate: string, amountCents: number): RevenueEntry => ({ id, kind: "sale", competenceDate, amountCents, description: id });
const rule = resolveRule("mei-geral", 2026);

describe("limite MEI — porta de engine.limit_report", () => {
  it("limite atingido exatamente com abertura em outubro (3 meses = R$ 20.250)", () => {
    const r = limitReport({ entries: [sale("a", "2026-10-01", 2_025_000)], openedOn: "2026-10-01", year: 2026 });
    expect(r.activeMonths).toBe(3);
    expect(r.limitCents).toBe(2_025_000);
    expect(r.status).toBe("limite_atingido");
  });

  it("excesso superior a 20% (caso do protótipo: +405.001 centavos)", () => {
    const r = limitReport({ entries: [sale("a", "2026-10-01", 2_025_000 + 405_001)], openedOn: "2026-10-01", year: 2026 });
    expect(r.status).toBe("excesso_acima_20");
  });

  it("recebimentos (caixa) não contam para o limite — só receita por competência", () => {
    const r = limitReport({ entries: [], openedOn: "2026-10-01", year: 2026 });
    expect(r.grossCents).toBe(0);
    expect(r.status).toBe("normal");
  });
});

describe("limiares 80/90/100/120%", () => {
  const L = 8_100_000;
  it.each([
    [6_479_999, "normal"],
    [6_480_000, "monitorar"],
    [7_289_999, "monitorar"],
    [7_290_000, "atencao"],
    [8_099_999, "atencao"],
    [8_100_000, "limite_atingido"],
    [8_100_001, "excesso_ate_20"],
    [9_720_000, "excesso_ate_20"],
    [9_720_001, "excesso_acima_20"],
  ] as const)("%i centavos → %s", (gross, status) => {
    expect(classify(gross, L, rule)).toBe(status);
  });
});

describe("proporcionalidade e calendário", () => {
  it("abertura em dezembro: 1 mês = R$ 6.750", () => {
    expect(activeMonths("2026-12-15", 2026)).toBe(1);
    const r = limitReport({ entries: [], openedOn: "2026-12-15", year: 2026 });
    expect(r.limitCents).toBe(675_000);
  });

  it("abertura em janeiro: 12 meses", () => {
    expect(activeMonths("2026-01-31", 2026)).toBe(12);
  });

  it("anos seguintes à abertura usam limite cheio; ano anterior à abertura não tem atividade", () => {
    expect(limitReport({ entries: [], openedOn: "2024-07-01", year: 2026 }).limitCents).toBe(8_100_000);
    const before = limitReport({ entries: [], openedOn: "2027-02-01", year: 2026 });
    expect(before.limitCents).toBe(0);
    expect(before.status).toBe("sem_atividade");
  });

  it("virada do ano: venda de 31/12 conta no ano dela, de 01/01 no seguinte", () => {
    const entries = [sale("dez", "2025-12-31", 100_000), sale("jan", "2026-01-01", 50_000)];
    expect(limitReport({ entries, openedOn: "2025-01-01", year: 2025 }).grossCents).toBe(100_000);
    expect(limitReport({ entries, openedOn: "2025-01-01", year: 2026 }).grossCents).toBe(50_000);
  });

  it("ignora receita com competência anterior à abertura", () => {
    const r = limitReport({ entries: [sale("x", "2026-03-01", 10_000)], openedOn: "2026-04-01", year: 2026 });
    expect(r.grossCents).toBe(0);
  });
});

describe("estornos, histórico e regras versionadas", () => {
  it("estorno ligado ao original reduz a receita na competência do original", () => {
    const entries: RevenueEntry[] = [
      sale("v1", "2025-12-20", 100_000),
      { id: "e1", kind: "reversal", competenceDate: "2026-01-05", amountCents: 40_000, description: "dev", reversalOf: "v1" },
    ];
    expect(limitReport({ entries, openedOn: "2025-01-01", year: 2025 }).grossCents).toBe(60_000);
    expect(limitReport({ entries, openedOn: "2025-01-01", year: 2026 }).grossCents).toBe(0);
  });

  it("estorno sem original ou acima do original é rejeitado", () => {
    expect(() =>
      limitReport({ entries: [{ id: "e", kind: "reversal", competenceDate: "2026-01-01", amountCents: 1, description: "", reversalOf: "nada" }], openedOn: "2025-01-01", year: 2026 }),
    ).toThrow(/original/);
    expect(() =>
      limitReport({
        entries: [sale("v", "2026-01-01", 100), { id: "e", kind: "reversal", competenceDate: "2026-01-01", amountCents: 101, description: "", reversalOf: "v" }],
        openedOn: "2025-01-01",
        year: 2026,
      }),
    ).toThrow(/excede/);
  });

  it("histórico importado conta para o limite", () => {
    const entries: RevenueEntry[] = [{ id: "h", kind: "historical_import", competenceDate: "2026-02-01", amountCents: 500_000, description: "h" }];
    expect(limitReport({ entries, openedOn: "2025-01-01", year: 2026 }).grossCents).toBe(500_000);
  });

  it("MEI caminhoneiro não é suportado; ano sem regra falha explicitamente", () => {
    expect(() => resolveRule("mei-caminhoneiro", 2026)).toThrow(/caminhoneiro/);
    expect(() => resolveRule("mei-geral", 2010)).toThrow(/Nenhuma regra/);
    expect(TAX_RULES.every((r) => r.requiresAccountantReview)).toBe(true);
  });

  it("regra customizada por vigência é respeitada", () => {
    const rules = [...TAX_RULES.map((r) => ({ ...r, validTo: 2026 })), { ...TAX_RULES[0]!, id: "mei-geral-v2", validFrom: 2027, validTo: null, annualLimitCents: 13_000_000 }];
    expect(limitReport({ entries: [], openedOn: "2020-01-01", year: 2027, rules }).limitCents).toBe(13_000_000);
    expect(limitReport({ entries: [], openedOn: "2020-01-01", year: 2026, rules }).ruleId).toBe("mei-geral-v1");
  });
});

describe("projeção e receita mensal", () => {
  it("projeta média linear e mês de atingimento", () => {
    const entries = Array.from({ length: 10 }, (_, i) => sale(`m${i}`, `2026-${String(i + 1).padStart(2, "0")}-10`, 800_000));
    const r = limitReport({ entries, openedOn: "2025-01-01", year: 2026 });
    const p = projectLimit(r, "2026-10-31", "2025-01-01", rule);
    expect(p.monthlyAverageCents).toBe(800_000);
    expect(p.projectedAnnualCents).toBe(9_600_000);
    expect(p.projectedStatus).toBe("excesso_ate_20");
    expect(p.breachMonth).toBe(11);
  });

  it("receita mensal líquida de estornos", () => {
    const entries: RevenueEntry[] = [sale("a", "2026-03-02", 1000), { id: "r", kind: "reversal", competenceDate: "2026-04-01", amountCents: 300, description: "", reversalOf: "a" }];
    const m = monthlyRevenue(entries, 2026);
    expect(m[2]).toBe(700);
    expect(m[3]).toBe(0);
  });
});
