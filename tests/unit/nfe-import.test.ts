import { describe, expect, it } from "vitest";
import { accessKeyCheckDigit, decimalToScaled, isValidAccessKey, parseNfeXml, stockQuantity } from "@/modules/inventory/nfe-xml";
import { alreadyImported, guessPackFactor, importNfe, suggestItems, suggestSku, type NfeImportInput } from "@/modules/inventory/nfe-import";
import { buildSampleNfeXml, demoSampleNfeXml, sampleAccessKey, type SampleNfe } from "@/demo/sample-nfe";
import { runCommand } from "@/modules/commands";
import { simpleDre } from "@/modules/finance/dre";
import { stockBalance } from "@/modules/inventory/stock";
import { DomainError } from "@/lib/errors";
import { ctx, product, tenantState } from "./helpers";

const TODAY = "2026-11-26";

const spec = (over: Partial<SampleNfe> = {}): SampleNfe => ({
  number: 4521,
  issuedOn: "2026-11-25",
  items: [
    { code: "A-10", ean: "7890000000011", name: "BRIGADEIRO UN", unit: "UN", qty: "100.0000", unitPrice: "1.5000", total: "150.00", discount: "10.00", lots: [{ lot: "LT-9", val: "2026-12-20" }] },
    { code: "B-20", name: "CAIXA KRAFT PCT C/12", ncm: "48191000", unit: "PCT", qty: "2.5000", unitPrice: "40.0000", total: "100.00", freight: "4.00", ipi: "2.00", icmsSt: "1.50" },
  ],
  total: "247.50",
  duplicates: [
    { n: "001", due: "2026-12-10", value: "123.75" },
    { n: "002", due: "2027-01-09", value: "123.75" },
  ],
  ...over,
});

const base = () => ({
  ...tenantState(),
  products: [product({ id: "p1", sku: "BRIG-01", barcode: "7890000000011", costCents: 120 }), product({ id: "p2", sku: "CXPR-07", name: "Caixa presente", costCents: 300 })],
});

const decisions = (over: Partial<NfeImportInput> = {}): NfeImportInput => ({
  xml: buildSampleNfeXml(spec()),
  items: [
    { n: 1, action: "link", productId: "p1", factor: 1 },
    { n: 2, action: "link", productId: "p2", factor: 12 },
  ],
  paidNow: false,
  ...over,
});

describe("leitura do XML da NF-e", () => {
  it("lê emitente, itens com custo efetivo, lotes, duplicatas e protocolo", () => {
    const doc = parseNfeXml(buildSampleNfeXml(spec()));
    expect(isValidAccessKey(doc.accessKey)).toBe(true);
    expect(doc.accessKey).toBe(sampleAccessKey(spec()));
    expect(doc).toMatchObject({ number: "4521", series: "1", issuedOn: "2026-11-25", totalCents: 24750, authorized: true });
    expect(doc.supplier).toMatchObject({ document: "11222333000181", tradeName: "Distribuidora Exemplo", phone: "1133334444", uf: "SP" });
    const [a, b] = doc.items;
    expect(a).toMatchObject({ n: 1, code: "A-10", barcode: "7890000000011", quantity4: 1_000_000, grossCents: 15000, discountCents: 1000, totalCostCents: 14000 });
    expect(a!.lots).toEqual([{ lot: "LT-9", quantity4: 1_000_000, manufacturedOn: undefined, expiresOn: "2026-12-20" }]);
    // 100,00 + frete 4,00 + IPI 2,00 + ST 1,50
    expect(b).toMatchObject({ barcode: undefined, ncm: "48191000", unit: "PCT", quantity4: 25_000, extraCents: 750, totalCostCents: 10750 });
    expect(doc.duplicates).toEqual([
      { number: "001", dueDate: "2026-12-10", amountCents: 12375 },
      { number: "002", dueDate: "2027-01-09", amountCents: 12375 },
    ]);
  });

  it("decimais sem ponto flutuante e chave com dígito verificador", () => {
    expect(decimalToScaled("0.1", 2, "x")).toBe(10);
    expect(decimalToScaled("1.005", 2, "x")).toBe(101);
    expect(decimalToScaled("2.5", 4, "x")).toBe(25_000);
    expect(() => decimalToScaled("1,50", 2, "x")).toThrow(DomainError);
    expect(accessKeyCheckDigit("3526111122233300018155001000004521100031660")).toBeGreaterThanOrEqual(0);
    const key = sampleAccessKey(spec());
    expect(isValidAccessKey(key.slice(0, 43) + ((Number(key[43]) + 1) % 10))).toBe(false);
    expect(stockQuantity(25_000, 12)).toBe(30);
    expect(stockQuantity(25_000, 1)).toBeNull();
  });

  it("recusa arquivos que não são NF-e de compra autorizada", () => {
    expect(() => parseNfeXml("")).toThrow(/XML/);
    expect(() => parseNfeXml("%PDF-1.7 DANFE")).toThrow(/NF-e|ler/);
    expect(() => parseNfeXml(buildSampleNfeXml(spec({ model: "65" })))).toThrow(/NFC-e/);
    expect(() => parseNfeXml(buildSampleNfeXml(spec({ protocolStatus: "101" })))).toThrow(/não autorizada/);
    expect(parseNfeXml(buildSampleNfeXml(spec({ protocolStatus: null }))).authorized).toBeNull();
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>&e;</nfeProc>`;
    expect(() => parseNfeXml(xxe)).toThrow(/DOCTYPE/);
    expect(() => parseNfeXml("<a>" + "x".repeat(1_000_001) + "</a>")).toThrow(/grande/);
    const tampered = buildSampleNfeXml(spec()).replace(/<chNFe>\d+<\/chNFe>/, `<chNFe>${"3".repeat(44)}</chNFe>`);
    expect(() => parseNfeXml(tampered)).toThrow(/protocolo/);
  });
});

describe("importação da nota de compra", () => {
  it("sugere produtos por código de barras e SKU; depois pelo vínculo lembrado com fator", () => {
    const s = base();
    const doc = parseNfeXml(buildSampleNfeXml(spec()));
    expect(suggestItems(s, doc)).toEqual([
      { n: 1, productId: "p1", factor: 1, via: "barras" },
      { n: 2, factor: 12 }, // "PCT C/12": fator sugerido pelo nome
    ]);
    const { state } = importNfe(s, decisions(), ctx(TODAY));
    const doc2 = parseNfeXml(buildSampleNfeXml(spec({ number: 4600 })));
    expect(suggestItems(state, doc2)).toEqual([
      { n: 1, productId: "p1", factor: 1, via: "vinculo" },
      { n: 2, productId: "p2", factor: 12, via: "vinculo" },
    ]);
  });

  it("fator de embalagem sugerido pelo nome só quando resulta em unidades inteiras", () => {
    const item = (name: string, unit: string, q4 = 30_000) => ({ ...parseNfeXml(buildSampleNfeXml(spec())).items[1]!, name, unit, quantity4: q4 });
    expect(guessPackFactor(item("CAIXA KRAFT PCT C/12", "PCT"))).toBe(12);
    expect(guessPackFactor(item("COPO 200ML CX 50 UN", "CX"))).toBe(50);
    expect(guessPackFactor(item("OVOS", "DZ"))).toBe(12);
    expect(guessPackFactor(item("CAIXA C/12", "UN"))).toBe(1);
    expect(guessPackFactor(item("PCT C/3", "PCT", 2_500))).toBe(1); // 0,25 × 3 não é inteiro
  });

  it("entrada atômica: fornecedor por CNPJ, estoque com lote, custo médio, duplicatas reais e nada na DRE", () => {
    const { state: s, value } = importNfe(base(), decisions(), ctx(TODAY));
    expect(value).toMatchObject({ created: 0, linked: 2, ignored: 0 });
    const sup = s.suppliers.find((x) => x.document === "11222333000181")!;
    expect(sup.name).toBe("Distribuidora Exemplo");
    expect(stockBalance(s.stockMovements, "p1")).toBe(100);
    expect(stockBalance(s.stockMovements, "p2")).toBe(30); // 2,5 pacotes × 12
    const lotMv = s.stockMovements.find((m) => m.productId === "p1")!;
    expect(lotMv).toMatchObject({ lot: "LT-9", expiresOn: "2026-12-20", unitCostCents: 140, note: "Compra NF-e 4521/1", sourceId: value.purchaseId });
    expect(s.products.find((p) => p.id === "p2")!.costCents).toBe(358); // 107,50 / 30
    const titles = s.titles.filter((t) => t.kind === "payable");
    expect(titles.map((t) => [t.dueDate, t.amountCents, t.category, t.counterpartyId])).toEqual([
      ["2026-12-10", 12375, "Mercadorias", sup.id],
      ["2027-01-09", 12375, "Mercadorias", sup.id],
    ]);
    expect(simpleDre({ revenues: s.revenues, cogsCents: 0, movements: s.movements, start: "2026-11-01", end: "2027-02-01" }).expensesCents).toBe(0);
    expect(alreadyImported(s, value.accessKey)).toBe(true);
    expect(s.audit.at(-1)).toMatchObject({ action: "purchase.import_nfe" });
  });

  it("a mesma nota não entra duas vezes", () => {
    const { state } = importNfe(base(), decisions(), ctx(TODAY));
    expect(() => importNfe(state, decisions(), ctx(TODAY))).toThrow(expect.objectContaining({ code: "DOCUMENT_ALREADY_IMPORTED" }));
  });

  it("cria produto novo com NCM e código de barras da nota; ignora item; paga à vista pelo total da nota", () => {
    const s0 = base();
    const doc = parseNfeXml(buildSampleNfeXml(spec()));
    const sku = suggestSku(s0, doc.items[1]!);
    expect(sku).toBe("B-20");
    const { state: s, value } = importNfe(
      { ...s0, products: [s0.products[1]!] },
      decisions({
        items: [
          { n: 1, action: "create", factor: 1, product: { name: "Brigadeiro gourmet", sku: "BRIG-NOVO", category: "Doces", unit: "un", priceCents: 350, minStock: 10 } },
          { n: 2, action: "ignore", factor: 1 },
        ],
        paidNow: true,
      }),
      ctx(TODAY),
    );
    expect(value).toMatchObject({ created: 1, linked: 0, ignored: 1 });
    const np = s.products.find((p) => p.sku === "BRIG-NOVO")!;
    expect(np).toMatchObject({ barcode: "7890000000011", costCents: 140, trackStock: true, fiscal: { ncm: "17049020" } });
    expect(stockBalance(s.stockMovements, np.id)).toBe(100);
    expect(s.titles).toHaveLength(0);
    expect(s.movements.at(-1)).toMatchObject({ category: "inventory_purchase", amountCents: 24750, direction: "out" });
  });

  it("vincula a fornecedor já cadastrado sem CNPJ e grava o CNPJ; recusa CNPJ divergente", () => {
    const s0 = { ...base(), suppliers: [{ id: "for_1", name: "Distribuidora (cadastro antigo)", createdAt: "x" }] };
    const { state } = importNfe(s0, decisions({ supplierId: "for_1" }), ctx(TODAY));
    expect(state.suppliers).toHaveLength(1);
    expect(state.suppliers[0]!.document).toBe("11222333000181");
    const other = { ...base(), suppliers: [{ id: "for_2", name: "Outro", document: "99888777000161", createdAt: "x" }] };
    expect(() => importNfe(other, decisions({ supplierId: "for_2" }), ctx(TODAY))).toThrow(/CNPJ/);
  });

  it("exige decisão para todos os itens e fator que resulte em unidades inteiras", () => {
    expect(() => importNfe(base(), decisions({ items: [{ n: 1, action: "link", productId: "p1", factor: 1 }] }), ctx(TODAY))).toThrow(/cada item/);
    expect(() =>
      importNfe(base(), decisions({ items: [{ n: 1, action: "link", productId: "p1", factor: 1 }, { n: 2, action: "link", productId: "p2", factor: 1 }] }), ctx(TODAY)),
    ).toThrow(/unidades inteiras/);
    expect(() => importNfe(base(), decisions({ items: [{ n: 1, action: "ignore", factor: 1 }, { n: 2, action: "ignore", factor: 1 }] }), ctx(TODAY))).toThrow(/Nenhum item/);
  });

  it("divide lotes múltiplos quando as quantidades fecham com o item", () => {
    const xml = buildSampleNfeXml(
      spec({
        items: [{ code: "A-10", ean: "7890000000011", name: "BRIGADEIRO UN", unit: "UN", qty: "10.0000", unitPrice: "1.0000", total: "10.00", lots: [{ lot: "L1", qty: "4.0000", val: "2026-12-01" }, { lot: "L2", qty: "6.0000", val: "2026-12-15" }] }],
        total: "10.00",
        duplicates: [],
      }),
    );
    const { state } = importNfe(base(), { xml, items: [{ n: 1, action: "link", productId: "p1", factor: 1 }], paidNow: false, dueDate: "2026-12-20" }, ctx(TODAY));
    const mv = state.stockMovements.filter((m) => m.productId === "p1");
    expect(mv.map((m) => [m.lot, m.quantity, m.expiresOn])).toEqual([
      ["L1", 4, "2026-12-01"],
      ["L2", 6, "2026-12-15"],
    ]);
    expect(state.titles.map((t) => [t.dueDate, t.amountCents])).toEqual([["2026-12-20", 1000]]);
  });

  it("pelo barramento de comandos (mesmo caminho do servidor) e com a nota de exemplo da demo", () => {
    const s = { ...base(), suppliers: [{ id: "for_1", name: "Distribuidora Exemplo (fictícia)", document: "11222333000181", createdAt: "x" }] };
    const xml = demoSampleNfeXml(TODAY);
    const doc = parseNfeXml(xml);
    expect(doc.totalCents).toBe(43800);
    const out = runCommand(
      "purchase.importNfe",
      {
        xml,
        items: [
          { n: 1, action: "link", productId: "p1", factor: 1 },
          { n: 2, action: "create", factor: 1, product: { name: "Embalagem PET p/ 4 doces", sku: "DX-EMB4", category: "Embalagens", unit: "un", priceCents: 90, minStock: 20 } },
          { n: 3, action: "link", productId: "p2", factor: 12 },
        ],
        paidNow: false,
      },
      s,
      ctx(TODAY),
    );
    expect(out.value).toMatchObject({ created: 1, linked: 2 });
    expect(out.state.suppliers).toHaveLength(1);
    expect(stockBalance(out.state.stockMovements, "p2")).toBe(36);
    expect(out.state.titles.reduce((a, t) => a + t.amountCents, 0)).toBe(43800);
    expect(out.state.supplierItems).toHaveLength(3);
  });
});
