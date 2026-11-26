import { describe, expect, it } from "vitest";
import { basisPoints, formatBRL, parseCents, sumCents } from "@/modules/finance/money";

describe("money (porta de engine.cents)", () => {
  it("converte texto em centavos sem float", () => {
    expect(parseCents("12.34")).toBe(1234);
    expect(parseCents("12,34")).toBe(1234);
    expect(parseCents("1.234,56")).toBe(123456);
    expect(parseCents("R$ 0,10")).toBe(10);
    expect(parseCents("0.1")).toBe(10);
    expect(parseCents("1000000000")).toBe(100_000_000_000);
  });

  it.each(["NaN", "-1", "1.001", "Infinity", "", "abc", "0", "1e3", "1000000000.01"])("rejeita %s", (x) => {
    expect(() => parseCents(x)).toThrow();
  });

  it("aceita zero somente quando permitido", () => {
    expect(parseCents("0", { allowZero: true })).toBe(0);
  });

  it("evita erro clássico de float (0,1 + 0,2)", () => {
    expect(sumCents([parseCents("0,10"), parseCents("0,20")])).toBe(30);
  });

  it("formata BRL", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });

  it("pontos-base inteiros", () => {
    expect(basisPoints(6480000, 8100000)).toBe(8000);
    expect(basisPoints(1, 0)).toBe(0);
  });
});
