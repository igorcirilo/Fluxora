import { DomainError } from "@/lib/errors";
import type { Cents } from "@/modules/finance/money";
import { addDays, assertBizDate, type BizDate } from "@/modules/finance/dates";
import { audit, ACCOUNT_BANK, type Ctx, type TenantState } from "@/modules/tenants/state";
import type { Supplier, SupplierItemLink } from "@/modules/customers/customer";
import { createProduct } from "./ops";
import { receivePurchase, type PurchaseInput } from "./purchases";
import type { Product } from "./stock";
import { parseNfeXml, stockQuantity, type NfeDocument, type NfeItem } from "./nfe-xml";

/**
 * Importação do XML da NF-e de compra: fornecedor, itens, estoque com lote/validade, custo médio
 * e contas a pagar pelas duplicatas da nota — tudo em uma única operação (uma transação no servidor).
 * O servidor relê o XML: quantidades, custos, vencimentos e chave vêm do documento, não do cliente.
 */
export const NFE_IDEMPOTENCY_SCOPE = "nfe";
export const nfeIdempotencyKey = (accessKey: string) => `${NFE_IDEMPOTENCY_SCOPE}:${accessKey}`;
export const MAX_FACTOR = 10_000;

export type MatchVia = "vinculo" | "barras" | "sku";

export interface ItemSuggestion {
  n: number;
  productId?: string;
  factor: number;
  via?: MatchVia;
}

export interface NfeImportItemDecision {
  n: number;
  action: "link" | "create" | "ignore";
  productId?: string;
  factor: number;
  product?: { name: string; sku: string; category: string; unit: Product["unit"]; priceCents: Cents; minStock: number };
}

export interface NfeImportInput {
  xml: string;
  supplierId?: string;
  items: NfeImportItemDecision[];
  paidNow: boolean;
  accountId?: string;
  /** usado só quando a nota não traz duplicatas */
  dueDate?: BizDate;
  updateCost?: boolean;
}

export function findSupplierByDocument(state: TenantState, document: string): Supplier | undefined {
  return state.suppliers.find((s) => s.document === document);
}

export function alreadyImported(state: TenantState, accessKey: string): boolean {
  return Boolean(state.idempotency[nfeIdempotencyKey(accessKey)]);
}

/** Embalagem com quantidade no nome ("PCT C/12", "CX 24 UN") ⇒ fator sugerido; só para unidades de embalagem. */
export function guessPackFactor(item: NfeItem): number {
  if (!["CX", "PCT", "PT", "PAC", "FD", "DZ", "KIT", "EMB"].includes(item.unit)) return 1;
  if (item.unit === "DZ") return 12;
  const m = /\bC\/\s*(\d{1,4})\b/i.exec(item.name) ?? /\b(\d{1,4})\s*(?:UN|UNID|UNIDADES|UNDS?)\b/i.exec(item.name);
  const f = m ? Number(m[1]) : 1;
  return f >= 2 && f <= MAX_FACTOR && stockQuantity(item.quantity4, f) !== null ? f : 1;
}

/** Sugestão de produto para cada item: vínculo lembrado do fornecedor › código de barras › SKU igual ao código. */
export function suggestItems(state: TenantState, doc: NfeDocument, supplierId?: string): ItemSuggestion[] {
  const sid = supplierId ?? findSupplierByDocument(state, doc.supplier.document)?.id;
  const active = state.products.filter((p) => p.active && p.trackStock);
  return doc.items.map((it) => {
    const link = sid ? (state.supplierItems ?? []).find((l) => l.supplierId === sid && l.code === it.code) : undefined;
    if (link && active.some((p) => p.id === link.productId)) return { n: it.n, productId: link.productId, factor: link.factor, via: "vinculo" };
    const byBarcode = it.barcode ? active.find((p) => p.barcode === it.barcode) : undefined;
    if (byBarcode) return { n: it.n, productId: byBarcode.id, factor: guessPackFactor(it), via: "barras" };
    const sku = it.code.toUpperCase();
    const bySku = active.find((p) => p.sku === sku);
    if (bySku) return { n: it.n, productId: bySku.id, factor: guessPackFactor(it), via: "sku" };
    return { n: it.n, factor: guessPackFactor(it) };
  });
}

/** SKU sugerido para produto novo a partir do código do fornecedor (único no catálogo). */
export function suggestSku(state: TenantState, item: NfeItem, taken: Set<string> = new Set()): string {
  const base = (item.code.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24) || `NFE-${item.n}`).padEnd(2, "0");
  let sku = base;
  for (let i = 2; state.products.some((p) => p.sku === sku) || taken.has(sku); i++) sku = `${base.slice(0, 26)}-${i}`;
  return sku;
}

/** Lotes do item já convertidos para unidades de estoque; custo distribuído sem perder centavos. */
function itemEntries(it: NfeItem, quantity: number, factor: number): { quantity: number; lot?: string; expiresOn?: BizDate }[] {
  const lots = it.lots;
  if (lots.length > 1 && lots.every((l) => l.quantity4 !== undefined) && lots.reduce((s, l) => s + l.quantity4!, 0) === it.quantity4) {
    const split = lots.map((l) => ({ quantity: stockQuantity(l.quantity4!, factor), lot: l.lot || undefined, expiresOn: l.expiresOn }));
    if (split.every((l) => l.quantity !== null && l.quantity > 0)) return split as { quantity: number; lot?: string; expiresOn?: BizDate }[];
  }
  if (!lots.length) return [{ quantity }];
  const expiries = lots.map((l) => l.expiresOn).filter(Boolean).sort() as BizDate[];
  return [{ quantity, lot: lots.map((l) => l.lot).filter(Boolean).join(" / ").slice(0, 40) || undefined, expiresOn: expiries[0] }];
}

export function importNfe(state: TenantState, input: NfeImportInput, ctx: Ctx): { state: TenantState; value: { purchaseId: string; accessKey: string; created: number; linked: number; ignored: number } } {
  const doc = parseNfeXml(input.xml);
  if (alreadyImported(state, doc.accessKey)) throw new DomainError("DOCUMENT_ALREADY_IMPORTED", `A NF-e ${doc.number} deste fornecedor já foi importada.`);

  const byN = new Map(input.items.map((d) => [d.n, d]));
  if (byN.size !== input.items.length || input.items.length !== doc.items.length || doc.items.some((it) => !byN.has(it.n)))
    throw new DomainError("VALIDATION_ERROR", "Decida o que fazer com cada item da nota.");
  if (input.items.every((d) => d.action === "ignore")) throw new DomainError("EMPTY_CART", "Nenhum item selecionado para entrada no estoque.");

  let next = state;

  // 1) Fornecedor: escolhido › mesmo CNPJ › novo cadastro com os dados do emitente.
  let supplier: Supplier | undefined;
  if (input.supplierId) {
    supplier = next.suppliers.find((s) => s.id === input.supplierId);
    if (!supplier) throw new DomainError("VALIDATION_ERROR", "Fornecedor não encontrado.");
    if (supplier.document && supplier.document !== doc.supplier.document) throw new DomainError("VALIDATION_ERROR", "O CNPJ do fornecedor escolhido é diferente do emitente da nota.");
    if (!supplier.document) {
      const upd: Supplier = { ...supplier, document: doc.supplier.document, phone: supplier.phone ?? doc.supplier.phone };
      next = { ...next, suppliers: next.suppliers.map((s) => (s.id === upd.id ? upd : s)) };
      supplier = upd;
    }
  } else {
    supplier = findSupplierByDocument(next, doc.supplier.document);
    if (!supplier) {
      supplier = { id: ctx.newId("for"), name: (doc.supplier.tradeName ?? doc.supplier.name).slice(0, 120), phone: doc.supplier.phone, document: doc.supplier.document, createdAt: ctx.nowIso };
      next = { ...next, suppliers: [...next.suppliers, supplier], audit: [...next.audit, audit(next, ctx, "supplier.create", "supplier", supplier.id, "via NF-e")] };
    }
  }

  // 2) Itens: vincular, criar produto (com NCM/CEST da nota) ou ignorar.
  const purchaseItems: PurchaseInput["items"] = [];
  const links: SupplierItemLink[] = [...(next.supplierItems ?? [])];
  let created = 0;
  let linked = 0;
  let ignored = 0;
  for (const it of doc.items) {
    const d = byN.get(it.n)!;
    if (d.action === "ignore") {
      ignored++;
      continue;
    }
    if (!Number.isInteger(d.factor) || d.factor < 1 || d.factor > MAX_FACTOR) throw new DomainError("INVALID_QUANTITY", `Item ${it.n}: fator de conversão inválido.`);
    const quantity = stockQuantity(it.quantity4, d.factor);
    if (quantity === null || quantity <= 0 || quantity > 1_000_000)
      throw new DomainError("INVALID_QUANTITY", `Item ${it.n} (${it.name}): a quantidade da nota não resulta em unidades inteiras com fator ${d.factor}. Ajuste o fator.`);
    let productId: string;
    if (d.action === "create") {
      if (!d.product) throw new DomainError("VALIDATION_ERROR", `Item ${it.n}: informe os dados do novo produto.`);
      const before = next.products.length;
      next = createProduct(
        next,
        {
          ...d.product,
          barcode: it.barcode && !next.products.some((p) => p.barcode === it.barcode) ? it.barcode : undefined,
          costCents: Math.round(it.totalCostCents / quantity),
          trackStock: true,
          fiscal: it.ncm || it.cest ? { ncm: it.ncm, cest: it.cest } : undefined,
        },
        ctx,
      );
      productId = next.products[before]!.id;
      created++;
    } else {
      const p = next.products.find((x) => x.id === d.productId);
      if (!p) throw new DomainError("PRODUCT_NOT_FOUND", `Item ${it.n}: produto não encontrado.`);
      if (!p.trackStock) throw new DomainError("VALIDATION_ERROR", `${p.name} não controla estoque.`);
      productId = p.id;
      linked++;
    }
    const entries = itemEntries(it, quantity, d.factor);
    // Custo por unidade de estoque, arredondado; o valor a pagar segue exatamente a nota.
    const unitCostCents = Math.round(it.totalCostCents / quantity);
    for (const e of entries) purchaseItems.push({ productId, quantity: e.quantity, unitCostCents, lot: e.lot, expiresOn: e.expiresOn });
    const existing = links.findIndex((l) => l.supplierId === supplier.id && l.code === it.code);
    const link: SupplierItemLink = { supplierId: supplier.id, code: it.code, productId, factor: d.factor, updatedAt: ctx.nowIso };
    if (existing >= 0) links[existing] = link;
    else links.push(link);
  }

  // 3) Estoque + custo médio + pagamento (duplicatas da nota, ou vencimento único, ou pago agora).
  const purchaseId = ctx.newId("cmp");
  const label = `NF-e ${doc.number}/${doc.series}`;
  const description = `Compra de mercadorias ${label} — ${supplier.name}`.slice(0, 150);
  const schedule = !input.paidNow && doc.duplicates.length ? doc.duplicates.map((x) => ({ dueDate: x.dueDate, amountCents: x.amountCents })) : undefined;
  const totalCents = schedule ? schedule.reduce((s, x) => s + x.amountCents, 0) : doc.totalCents;
  if (input.dueDate) assertBizDate(input.dueDate);
  next = receivePurchase(
    next,
    {
      supplierId: supplier.id,
      items: purchaseItems,
      paidNow: input.paidNow,
      accountId: input.paidNow ? (input.accountId ?? ACCOUNT_BANK) : undefined,
      firstDueDate: schedule ? schedule[0]!.dueDate : (input.dueDate ?? addDays(ctx.today, 30)),
      installments: 1,
      updateCost: input.updateCost,
      document: label,
      purchaseId,
      payment: { totalCents, schedule, description },
    },
    ctx,
  );

  next = {
    ...next,
    supplierItems: links,
    idempotency: { ...next.idempotency, [nfeIdempotencyKey(doc.accessKey)]: purchaseId },
    audit: [...next.audit, audit(next, ctx, "purchase.import_nfe", "purchase", purchaseId, `${label} chave ${doc.accessKey} · ${created} novo(s), ${linked} vinculado(s), ${ignored} ignorado(s)`)],
  };
  return { state: next, value: { purchaseId, accessKey: doc.accessKey, created, linked, ignored } };
}
