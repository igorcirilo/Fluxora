import { z } from "zod";
import type { Ctx, TenantState } from "@/modules/tenants/state";
import { checkout } from "@/modules/sales/checkout";
import { returnSale } from "@/modules/sales/returns";
import { closeSession, drawerTransfer, openSession } from "@/modules/sales/cash-session";
import { createProduct, moveStock, updateProduct } from "@/modules/inventory/ops";
import { createCustomer, updateCustomer } from "@/modules/customers/ops";
import { addMovement, createTitles, importHistoricalRevenue, reverseMovement, settleTitle, transfer } from "@/modules/finance/ops";
import { registerDasPayment } from "@/modules/mei/ops";
import { createFiscalDraft, discardFiscalDraft } from "@/modules/fiscal/ops";
import { grantAccountant, revokeAccountant, updateTenant } from "@/modules/tenants/ops";
import { createSupplier, receivePurchase } from "@/modules/inventory/purchases";
import { importNfe } from "@/modules/inventory/nfe-import";
import { NFE_XML_MAX_CHARS } from "@/modules/inventory/nfe-xml";
import { setAccountantReview, updateFiscalSettings } from "@/modules/fiscal/settings-ops";

/**
 * Barramento de comandos: a ÚNICA forma de alterar dados de um tenant.
 * Cada comando tem schema Zod (validado também no servidor) e uma função de domínio pura.
 * O mesmo registro roda na demo (navegador) e no servidor (transação PostgreSQL com RLS).
 */
const id = z.string().min(1).max(64);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(100_000_000_000);
const pos = cents.refine((v) => v > 0, "Valor deve ser positivo");
const text = (max: number) => z.string().max(max);
const productFields = {
  name: text(120),
  sku: text(30),
  barcode: text(14).optional(),
  category: text(40),
  unit: z.enum(["un", "kg", "cx", "pct", "h"]),
  priceCents: pos,
  costCents: cents,
  minStock: z.number().int().min(0).max(1_000_000),
  trackStock: z.boolean(),
  fiscal: z
    .object({ ncm: text(10).optional(), cfop: text(5).optional(), csosn: text(3).optional(), origem: text(1).optional(), cest: text(9).optional() })
    .optional(),
};

type Out<T> = TenantState | { state: TenantState; value: T };

function cmd<S extends z.ZodType, T = void>(schema: S, run: (s: TenantState, input: z.infer<S>, c: Ctx) => Out<T>) {
  return { schema, run };
}

export const COMMANDS = {
  "sale.checkout": cmd(
    z.object({
      idempotencyKey: z.string().min(8).max(100),
      items: z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(10_000) })).min(1).max(200),
      discountCents: cents.optional(),
      payments: z.array(z.object({ method: z.enum(["dinheiro", "pix", "debito", "credito", "fiado"]), amountCents: pos })).min(1).max(10),
      cashTenderedCents: cents.optional(),
      customerId: id.optional(),
      creditDueDate: date.optional(),
      note: text(200).optional(),
    }),
    (s, i, c) => {
      const r = checkout(s, i, c);
      return { state: r.state, value: r.sale };
    },
  ),
  "sale.return": cmd(z.object({ saleId: id, reason: text(200).optional() }), (s, i, c) => returnSale(s, i.saleId, c, i.reason)),
  "cash.open": cmd(z.object({ openingCountCents: cents }), (s, i, c) => openSession(s, i.openingCountCents, c)),
  "cash.close": cmd(z.object({ countedCents: cents }), (s, i, c) => closeSession(s, i.countedCents, c)),
  "cash.drawer": cmd(z.object({ kind: z.enum(["sangria", "suprimento"]), amountCents: pos, note: text(120).optional() }), (s, i, c) => drawerTransfer(s, i.kind, i.amountCents, c, i.note)),
  "product.create": cmd(z.object({ ...productFields, initialStock: z.number().int().min(0).max(1_000_000).optional() }), (s, i, c) => createProduct(s, i, c)),
  "product.update": cmd(z.object({ id, ...productFields, active: z.boolean() }), (s, { id: pid, ...rest }, c) => updateProduct(s, pid, rest, c)),
  "stock.move": cmd(
    z.object({ productId: id, type: z.enum(["purchase", "loss", "adjustment"]), quantity: z.number().int().min(0).max(1_000_000), countedTo: z.number().int().min(0).max(1_000_000).optional(), note: text(120).optional() }),
    (s, i, c) => moveStock(s, i, c),
  ),
  "customer.create": cmd(z.object({ name: text(120), phone: text(20).optional(), email: text(254).optional(), notes: text(500).optional() }), (s, i, c) => createCustomer(s, i, c)),
  "customer.update": cmd(z.object({ id, name: text(120), phone: text(20).optional(), email: text(254).optional(), notes: text(500).optional() }), (s, { id: cid, ...rest }, c) => updateCustomer(s, cid, rest, c)),
  "supplier.create": cmd(z.object({ name: text(120), phone: text(20).optional() }), (s, i, c) => createSupplier(s, i, c)),
  "purchase.receive": cmd(
    z.object({
      supplierId: id.optional(),
      items: z.array(z.object({ productId: id, quantity: z.number().int().min(1).max(1_000_000), unitCostCents: cents, lot: text(40).optional(), expiresOn: date.optional() })).min(1).max(200),
      paidNow: z.boolean(),
      accountId: id.optional(),
      firstDueDate: date.optional(),
      installments: z.number().int().min(1).max(48).optional(),
      updateCost: z.boolean().optional(),
      document: text(60).optional(),
    }),
    (s, i, c) => receivePurchase(s, i, c),
  ),
  "purchase.importNfe": cmd(
    z.object({
      xml: z.string().min(50).max(NFE_XML_MAX_CHARS),
      supplierId: id.optional(),
      items: z
        .array(
          z.object({
            n: z.number().int().min(1).max(999),
            action: z.enum(["link", "create", "ignore"]),
            productId: id.optional(),
            factor: z.number().int().min(1).max(10_000),
            product: z.object({ name: text(120), sku: text(30), category: text(40), unit: productFields.unit, priceCents: pos, minStock: productFields.minStock }).optional(),
          }),
        )
        .min(1)
        .max(200),
      paidNow: z.boolean(),
      accountId: id.optional(),
      dueDate: date.optional(),
      updateCost: z.boolean().optional(),
    }),
    (s, i, c) => importNfe(s, i, c),
  ),
  "title.create": cmd(
    z.object({ kind: z.enum(["receivable", "payable"]), description: text(150), counterpartyId: id.optional(), competenceDate: date, firstDueDate: date, totalCents: pos, installments: z.number().int().min(1).max(48), category: text(40).optional() }),
    (s, i, c) => createTitles(s, i, c),
  ),
  "title.settle": cmd(z.object({ titleId: id, amountCents: pos, date, accountId: id }), (s, i, c) => settleTitle(s, i, c)),
  "movement.add": cmd(
    z.object({
      accountId: id,
      date,
      direction: z.enum(["in", "out"]),
      amountCents: pos,
      category: z.enum(["expense", "fee", "other_income", "owner_withdrawal", "capital_contribution", "loan"]),
      description: text(200),
    }),
    (s, i, c) => addMovement(s, i, c),
  ),
  "movement.reverse": cmd(z.object({ movementId: id }), (s, i, c) => reverseMovement(s, i.movementId, c)),
  "transfer.create": cmd(z.object({ from: id, to: id, date, amountCents: pos, description: text(200) }), (s, i, c) => transfer(s, i, c)),
  "revenue.import": cmd(z.object({ competenceDate: date, amountCents: pos, description: text(200) }), (s, i, c) => importHistoricalRevenue(s, i, c)),
  "das.register": cmd(z.object({ competence: z.string().regex(/^\d{4}-\d{2}$/), amountCents: pos, paidOn: date, proofNote: text(120), accountId: id.optional() }), (s, i, c) => registerDasPayment(s, i, c)),
  "fiscal.draft": cmd(z.object({ saleId: id, type: z.enum(["nfse", "nfce", "nfe"]) }), (s, i, c) => createFiscalDraft(s, i, c)),
  "fiscal.discard": cmd(z.object({ id }), (s, i, c) => discardFiscalDraft(s, i.id, c)),
  "fiscal.settings": cmd(
    z.object({
      ie: text(20).optional(),
      environment: z.enum(["homologacao", "producao"]),
      series: z.number().int().min(1).max(999),
      nextNumber: z.number().int().min(1).max(999_999_999),
      crt: z.enum(["1", "2", "3", "4"]).optional(),
      accreditationConfirmed: z.boolean(),
      certificateConfigured: z.boolean(),
      cscConfigured: z.boolean(),
    }),
    (s, i, c) => updateFiscalSettings(s, i, c),
  ),
  "fiscal.review": cmd(z.object({ name: text(120), note: text(300).optional(), confirmed: z.boolean() }), (s, i, c) => setAccountantReview(s, i, c)),
  "tenant.update": cmd(
    z.object({ name: text(150), tradeName: text(80), openedOn: date, segment: z.enum(["comercio", "servicos", "misto"]), city: text(60), uf: text(2), allowNegativeStock: z.boolean() }),
    (s, i, c) => updateTenant(s, i, c),
  ),
  "accountant.grant": cmd(z.object({ accountantName: text(120), firm: text(120), email: text(254), scopes: z.array(z.enum(["read", "export"])).min(1).max(2) }), (s, i, c) => grantAccountant(s, i, c)),
  "accountant.revoke": cmd(z.object({ id }), (s, i, c) => revokeAccountant(s, i.id, c)),
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandInput<K extends CommandName> = z.input<(typeof COMMANDS)[K]["schema"]>;

/** Valida e executa um comando sobre o estado (puro). Lança ZodError ou DomainError. */
export function runCommand(name: string, input: unknown, state: TenantState, ctx: Ctx): { state: TenantState; value: unknown } {
  const def = (COMMANDS as Record<string, { schema: z.ZodType; run: (s: TenantState, i: unknown, c: Ctx) => Out<unknown> }>)[name];
  if (!def) throw new z.ZodError([{ code: "custom", path: ["name"], message: "Comando desconhecido.", input: name }]);
  const parsed = def.schema.parse(input);
  const out = def.run(state, parsed, ctx);
  return "value" in out && "state" in out ? out : { state: out as TenantState, value: undefined };
}
