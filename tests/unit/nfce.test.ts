import { describe, expect, it } from "vitest";
import { formatIeSP, isValidIeSP, nfceReadiness, nfceSaleIssues, normalizeFiscalSettings, normalizeProductFiscal, DEFAULT_FISCAL_SETTINGS } from "@/modules/fiscal/nfce";
import { setAccountantReview, updateFiscalSettings, fiscalSettingsOf } from "@/modules/fiscal/settings-ops";
import { createProduct, updateProduct } from "@/modules/inventory/ops";
import { runCommand } from "@/modules/commands";
import { ctx, product, tenantState } from "./helpers";

describe("validação de formato fiscal", () => {
  it("IE de SP com os dois dígitos verificadores (exemplo oficial 110.042.490.114)", () => {
    expect(isValidIeSP("110.042.490.114")).toBe(true);
    expect(isValidIeSP("110042490115")).toBe(false);
    expect(isValidIeSP("110042491114")).toBe(false);
    expect(isValidIeSP("12345")).toBe(false);
    expect(formatIeSP("110042490114")).toBe("110.042.490.114");
  });

  it("NCM, CFOP, CSOSN, origem e CEST", () => {
    expect(normalizeProductFiscal({ ncm: "1704.90.90", cfop: "5102", csosn: "102", origem: "0" })).toEqual({ ncm: "17049090", cfop: "5102", csosn: "102", origem: "0" });
    expect(normalizeProductFiscal({ ncm: "", cfop: "" })).toBeUndefined();
    expect(() => normalizeProductFiscal({ ncm: "1234" })).toThrow(/NCM/);
    expect(() => normalizeProductFiscal({ cfop: "9102" })).toThrow(/CFOP/);
    expect(() => normalizeProductFiscal({ csosn: "101" })).toThrow(/CSOSN/);
    expect(() => normalizeProductFiscal({ origem: "9" })).toThrow(/Origem/);
    expect(() => normalizeProductFiscal({ cest: "12" })).toThrow(/CEST/);
  });

  it("configuração: só SP, série/número válidos e produção exige revisão do contador", () => {
    expect(() => normalizeFiscalSettings({ ie: "110042490115" }, DEFAULT_FISCAL_SETTINGS)).toThrow(/inválida/);
    expect(() => normalizeFiscalSettings({ series: 0 }, DEFAULT_FISCAL_SETTINGS)).toThrow(/Série/);
    expect(() => normalizeFiscalSettings({ environment: "producao" }, DEFAULT_FISCAL_SETTINGS)).toThrow(/contador/);
    expect(() => normalizeFiscalSettings({ uf: "RJ" }, DEFAULT_FISCAL_SETTINGS)).toThrow(/SP/);
    expect(normalizeFiscalSettings({ ie: "110.042.490.114" }, DEFAULT_FISCAL_SETTINGS).ie).toBe("110042490114");
  });
});

describe("prontidão da NFC-e", () => {
  it("checklist só fica pronto com tudo ok — e o provedor desabilitado bloqueia", () => {
    const c = ctx();
    let s = { ...tenantState(), products: [product()] };
    let r = nfceReadiness(fiscalSettingsOf(s), s.products, false);
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.id === "provedor")!.status).toBe("bloqueado");
    expect(r.productsMissing).toHaveLength(1);
    s = updateProduct(s, "p1", { ...product(), active: true, fiscal: { ncm: "17049090", cfop: "5102", csosn: "102", origem: "0" } }, c);
    s = updateFiscalSettings(s, { ie: "110042490114", environment: "homologacao", series: 1, nextNumber: 1, crt: "4", accreditationConfirmed: true, certificateConfigured: true, cscConfigured: true }, c);
    s = setAccountantReview(s, { name: "Mônica (fictícia)", confirmed: true }, c);
    s = updateFiscalSettings(s, { ie: "110042490114", environment: "producao", series: 1, nextNumber: 1, crt: "4", accreditationConfirmed: true, certificateConfigured: true, cscConfigured: true }, c);
    r = nfceReadiness(fiscalSettingsOf(s), s.products, true);
    expect(r.items.filter((i) => i.status !== "ok")).toEqual([]);
    expect(r.ready).toBe(true);
    expect(s.audit.some((a) => a.action === "fiscal.review")).toBe(true);
  });

  it("revogar a revisão volta o ambiente para homologação", () => {
    const c = ctx();
    let s = setAccountantReview(tenantState(), { name: "Contador", confirmed: true }, c);
    s = updateFiscalSettings(s, { environment: "producao", series: 1, nextNumber: 1, accreditationConfirmed: false, certificateConfigured: false, cscConfigured: false }, c);
    s = setAccountantReview(s, { name: "", confirmed: false }, c);
    expect(fiscalSettingsOf(s)).toMatchObject({ environment: "homologacao" });
    expect(fiscalSettingsOf(s).accountantReview).toBeUndefined();
  });

  it("pendências de uma venda para NFC-e e produto criado com dados fiscais via comando", () => {
    const c = ctx();
    const r = runCommand("product.create", { name: "Café 500 g", sku: "CAFE-500", category: "Mercearia", unit: "un", priceCents: 1890, costCents: 1000, minStock: 0, trackStock: true, initialStock: 3, fiscal: { ncm: "0901.21.00", cfop: "5102", csosn: "102", origem: "0" } }, tenantState(), c);
    expect(r.state.products[0]!.fiscal).toEqual({ ncm: "09012100", cfop: "5102", csosn: "102", origem: "0" });
    const s = createProduct(r.state, { name: "Sem fiscal", sku: "SEM-01", category: "x", unit: "un", priceCents: 100, costCents: 0, minStock: 0, trackStock: true }, c);
    const sale = runCommand("sale.checkout", { idempotencyKey: "nfce-000001", items: [{ productId: s.products[1]!.id, quantity: 1 }], payments: [{ method: "pix", amountCents: 100 }] }, { ...s, stockMovements: [...s.stockMovements, { id: "x", productId: s.products[1]!.id, type: "initial", quantity: 1, date: "2026-01-01", createdAt: "x" }] }, c);
    const issues = nfceSaleIssues(sale.value as never, sale.state.products, fiscalSettingsOf(sale.state));
    expect(issues).toContain("Empresa sem inscrição estadual.");
    expect(issues.some((i) => i.includes("sem NCM"))).toBe(true);
  });
});
