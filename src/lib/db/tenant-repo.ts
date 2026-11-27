import type { PoolClient } from "pg";
import { DomainError } from "@/lib/errors";
import type { Tenant, TenantState, AuditEntry } from "@/modules/tenants/state";
import type { CashAccount, CashMovement } from "@/modules/finance/cash";
import type { Title } from "@/modules/finance/titles";
import type { Product, StockMovement } from "@/modules/inventory/stock";
import type { Customer, Supplier } from "@/modules/customers/customer";
import type { RevenueEntry } from "@/modules/mei/revenue";
import type { DasPaymentRecord } from "@/modules/mei/calendar";
import type { FiscalDocument } from "@/modules/fiscal/provider";
import type { AccountantLink } from "@/modules/accounting/links";
import type { CashSession, Sale } from "@/modules/sales/types";
import { DEFAULT_FISCAL_SETTINGS, type FiscalSettings, type ProductFiscal } from "@/modules/fiscal/nfce";

/**
 * Persistência do agregado do tenant no PostgreSQL. Executar SEMPRE dentro de withTenant():
 * todas as consultas passam pelo RLS. Domínio puro → estado novo → gravamos apenas a diferença.
 * Coleções de histórico são somente-inserção; alteração ou remoção nelas aborta a transação.
 */
const d = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const ts = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const n = (v: unknown): number => Number(v);
const opt = <T,>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

export async function loadTenantState(c: PoolClient, tenantId: string): Promise<TenantState> {
  const q = async (sql: string) => (await c.query(sql, [tenantId])).rows;
  const [t] = await q("SELECT * FROM app.tenants WHERE id = $1");
  if (!t) throw new DomainError("TENANT_ACCESS_DENIED", "Empresa não encontrada.");
  const tenant: Tenant = { id: t.id, name: t.name, tradeName: t.trade_name, openedOn: d(t.opened_on), regime: t.regime, segment: t.segment, city: t.city, uf: t.uf ?? "", allowNegativeStock: t.allow_negative_stock, isDemo: false };

  const accounts: CashAccount[] = (await q("SELECT * FROM app.accounts WHERE tenant_id = $1 ORDER BY id")).map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
  const products: Product[] = (await q("SELECT * FROM app.products WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({
    id: r.id, sku: r.sku, barcode: opt(r.barcode), name: r.name, category: r.category, unit: r.unit, priceCents: n(r.price_cents), costCents: n(r.cost_cents), minStock: r.min_stock, trackStock: r.track_stock, active: r.active, createdAt: ts(r.created_at),
    ...(fiscalOf(r) ? { fiscal: fiscalOf(r) } : {}),
  }));
  const stockMovements: StockMovement[] = (await q("SELECT * FROM app.stock_movements WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({
    id: r.id, productId: r.product_id, type: r.type, quantity: r.quantity, date: d(r.movement_date), createdAt: ts(r.created_at), unitCostCents: r.unit_cost_cents === null ? undefined : n(r.unit_cost_cents), sourceId: opt(r.source_id), note: opt(r.note), lot: opt(r.lot), expiresOn: r.expires_on ? d(r.expires_on) : undefined,
  }));
  const customers: Customer[] = (await q("SELECT * FROM app.customers WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({ id: r.id, name: r.name, phone: opt(r.phone), email: opt(r.email), notes: opt(r.notes), createdAt: ts(r.created_at) }));
  const suppliers: Supplier[] = (await q("SELECT * FROM app.suppliers WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({ id: r.id, name: r.name, phone: opt(r.phone), createdAt: ts(r.created_at) }));

  const items = await q("SELECT * FROM app.sale_items WHERE tenant_id = $1 ORDER BY id");
  const pays = await q("SELECT * FROM app.payments WHERE tenant_id = $1 ORDER BY id");
  const sales: Sale[] = (await q("SELECT * FROM app.sales WHERE tenant_id = $1 ORDER BY number")).map((r) => ({
    id: r.id, number: r.number, idempotencyKey: r.idempotency_key, createdAt: ts(r.created_at), date: d(r.sale_date), customerId: opt(r.customer_id), cashSessionId: opt(r.cash_session_id), note: opt(r.note),
    items: items.filter((i) => i.sale_id === r.id).map((i) => ({ productId: i.product_id, name: i.name, quantity: i.quantity, unitPriceCents: n(i.unit_price_cents), unitCostCents: n(i.unit_cost_cents), totalCents: n(i.total_cents) })),
    payments: pays.filter((p) => p.sale_id === r.id).map((p) => ({ method: p.method, amountCents: n(p.amount_cents) })),
    subtotalCents: n(r.subtotal_cents), discountCents: n(r.discount_cents), totalCents: n(r.total_cents), cashTenderedCents: n(r.cash_tendered_cents), changeCents: n(r.change_cents), status: r.status, returnedAt: r.returned_at ? ts(r.returned_at) : undefined,
  }));
  const revenues: RevenueEntry[] = (await q("SELECT * FROM app.revenue_entries WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({ id: r.id, kind: r.kind, competenceDate: d(r.competence_date), amountCents: n(r.amount_cents), description: r.description, reversalOf: opt(r.reversal_of), sourceId: opt(r.source_id) }));
  const movements: CashMovement[] = (await q("SELECT * FROM app.ledger_entries WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({
    id: r.id, accountId: r.account_id, date: d(r.entry_date), direction: r.direction, amountCents: n(r.amount_cents), category: r.category, description: r.description, transferId: opt(r.transfer_id), reversalOf: opt(r.reversal_of), sourceId: opt(r.source_id), sessionId: opt(r.cash_session_id),
  }));
  const stl = await q("SELECT * FROM app.settlements WHERE tenant_id = $1 ORDER BY settled_on, id");
  const titles: Title[] = (await q("SELECT * FROM app.titles WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({
    id: r.id, kind: r.kind, description: r.description, counterpartyId: opt(r.customer_id ?? r.supplier_id), competenceDate: d(r.competence_date), dueDate: d(r.due_date), amountCents: n(r.amount_cents),
    installment: r.installment_group ? { number: r.installment_number, of: r.installment_count, groupId: r.installment_group } : undefined, category: opt(r.category), sourceId: opt(r.source_id), cancelledAt: r.cancelled_at ? ts(r.cancelled_at) : undefined,
    settlements: stl.filter((s) => s.title_id === r.id).map((s) => ({ id: s.id, date: d(s.settled_on), amountCents: n(s.amount_cents), accountId: s.account_id, movementId: s.ledger_entry_id })),
  }));
  const cashSessions: CashSession[] = (await q("SELECT * FROM app.cash_sessions WHERE tenant_id = $1 ORDER BY opened_at, id")).map((r) => ({
    id: r.id, openedAt: ts(r.opened_at), openedOn: d(r.opened_on), openingCountCents: n(r.opening_count_cents), closedAt: r.closed_at ? ts(r.closed_at) : undefined, countedCents: r.counted_cents === null ? undefined : n(r.counted_cents), expectedCents: r.expected_cents === null ? undefined : n(r.expected_cents), differenceCents: r.difference_cents === null ? undefined : n(r.difference_cents),
  }));
  const dasPayments: DasPaymentRecord[] = (await q("SELECT * FROM app.tax_obligations WHERE tenant_id = $1 AND kind = 'das' AND paid_on IS NOT NULL ORDER BY competence")).map((r) => ({ competence: r.competence, amountCents: n(r.amount_cents), paidOn: d(r.paid_on), proofNote: opt(r.proof_note) }));
  const ev = await q("SELECT * FROM app.fiscal_events WHERE tenant_id = $1 ORDER BY created_at, id");
  const fiscalDocuments: FiscalDocument[] = (await q("SELECT * FROM app.fiscal_documents WHERE tenant_id = $1 ORDER BY created_at, id")).map((r) => ({
    id: r.id, type: r.type, saleId: opt(r.sale_id), status: r.status, protocol: opt(r.protocol), createdAt: ts(r.created_at), events: ev.filter((e) => e.document_id === r.id).map((e) => ({ to: e.to_status, at: ts(e.created_at), protocol: opt(e.protocol), message: opt(e.message) })),
  }));
  const accountantLinks: AccountantLink[] = (await q("SELECT * FROM app.accountant_links WHERE tenant_id = $1 ORDER BY granted_at, id")).map((r) => ({ id: r.id, accountantName: r.accountant_name, firm: r.firm, email: r.email, scopes: r.scopes, grantedAt: ts(r.granted_at), revokedAt: r.revoked_at ? ts(r.revoked_at) : undefined }));
  const audit: AuditEntry[] = (await q("SELECT * FROM (SELECT * FROM app.audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 300) a ORDER BY created_at, id")).map((r) => ({ id: r.id, at: ts(r.created_at), actor: r.actor_user_id ?? "sistema", action: r.action, entity: r.entity, entityId: r.entity_id, details: opt(r.details) }));
  const [fs] = await q("SELECT * FROM app.fiscal_settings WHERE tenant_id = $1");
  const fiscal: FiscalSettings = fs
    ? {
        uf: fs.uf, ie: opt(fs.ie), environment: fs.environment, series: fs.series, nextNumber: n(fs.next_number), crt: opt(fs.crt), accreditationConfirmedAt: fs.accreditation_confirmed_at ? ts(fs.accreditation_confirmed_at) : undefined,
        certificateConfigured: fs.certificate_configured, cscConfigured: fs.csc_configured,
        accountantReview: fs.accountant_review_at ? { name: fs.accountant_review_name, at: ts(fs.accountant_review_at), note: opt(fs.accountant_review_note) } : undefined,
      }
    : { ...DEFAULT_FISCAL_SETTINGS };
  const idempotency: Record<string, string> = {};
  for (const r of await q("SELECT scope, key, resource_id FROM app.idempotency_keys WHERE tenant_id = $1")) idempotency[`${r.scope}:${r.key}`] = r.resource_id;
  return { tenant, accounts, products, stockMovements, customers, suppliers, sales, revenues, movements, titles, cashSessions, dasPayments, fiscalDocuments, fiscal, accountantLinks, audit, idempotency, seq: { sale: sales.reduce((m, s) => Math.max(m, s.number), 0) } };
}

function fiscalOf(r: Record<string, unknown>): ProductFiscal | undefined {
  const f: ProductFiscal = {};
  for (const k of ["ncm", "cfop", "csosn", "origem", "cest"] as const) if (r[k]) f[k] = String(r[k]);
  return Object.keys(f).length ? f : undefined;
}

const fv = (p: Product) => [p.fiscal?.ncm ?? null, p.fiscal?.cfop ?? null, p.fiscal?.csosn ?? null, p.fiscal?.origem ?? null, p.fiscal?.cest ?? null];

type Diff<T> = { added: T[]; changed: { before: T; after: T }[]; removed: T[] };
function diffBy<T>(before: readonly T[], after: readonly T[], key: (x: T) => string): Diff<T> {
  const b = new Map(before.map((x) => [key(x), x]));
  const a = new Map(after.map((x) => [key(x), x]));
  const out: Diff<T> = { added: [], changed: [], removed: [] };
  for (const [k, x] of a) {
    const prev = b.get(k);
    if (!prev) out.added.push(x);
    else if (prev !== x && JSON.stringify(prev) !== JSON.stringify(x)) out.changed.push({ before: prev, after: x });
  }
  for (const [k, x] of b) if (!a.has(k)) out.removed.push(x);
  return out;
}

function appendOnly<T>(name: string, df: Diff<T>) {
  if (df.changed.length || df.removed.length) throw new DomainError("VALIDATION_ERROR", `Histórico imutável (${name}) não pode ser alterado.`);
}

/** Grava a diferença entre dois estados do MESMO tenant. Deve rodar na mesma transação do withTenant. */
export async function persistDiff(c: PoolClient, before: TenantState, after: TenantState): Promise<void> {
  const tid = before.tenant.id;
  if (after.tenant.id !== tid) throw new DomainError("TENANT_ACCESS_DENIED", "Operação tentou alterar outra empresa.");
  const ins = (sql: string, vals: unknown[]) => c.query(sql, [tid, ...vals]);

  if (JSON.stringify(before.tenant) !== JSON.stringify(after.tenant)) {
    const t = after.tenant;
    await ins("UPDATE app.tenants SET name=$2, trade_name=$3, opened_on=$4, segment=$5, city=$6, uf=nullif($7,''), allow_negative_stock=$8 WHERE id=$1", [t.name, t.tradeName, t.openedOn, t.segment, t.city, t.uf, t.allowNegativeStock]);
  }

  // Ordem respeita as FKs compostas.
  const cus = diffBy(before.customers, after.customers, (x) => x.id);
  if (cus.removed.length) throw new DomainError("VALIDATION_ERROR", "Clientes não podem ser removidos por comando.");
  for (const x of cus.added) await ins("INSERT INTO app.customers (tenant_id,id,name,phone,email,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [x.id, x.name, x.phone ?? null, x.email ?? null, x.notes ?? null, x.createdAt]);
  for (const { after: x } of cus.changed) await ins("UPDATE app.customers SET name=$3, phone=$4, email=$5, notes=$6 WHERE tenant_id=$1 AND id=$2", [x.id, x.name, x.phone ?? null, x.email ?? null, x.notes ?? null]);

  const sup = diffBy(before.suppliers, after.suppliers, (x) => x.id);
  for (const x of sup.added) await ins("INSERT INTO app.suppliers (tenant_id,id,name,phone,created_at) VALUES ($1,$2,$3,$4,$5)", [x.id, x.name, x.phone ?? null, x.createdAt]);
  for (const { after: x } of sup.changed) await ins("UPDATE app.suppliers SET name=$3, phone=$4 WHERE tenant_id=$1 AND id=$2", [x.id, x.name, x.phone ?? null]);

  const acc = diffBy(before.accounts, after.accounts, (x) => x.id);
  for (const x of acc.added) await ins("INSERT INTO app.accounts (tenant_id,id,name,kind) VALUES ($1,$2,$3,$4)", [x.id, x.name, x.kind]);

  const prd = diffBy(before.products, after.products, (x) => x.id);
  if (prd.removed.length) throw new DomainError("VALIDATION_ERROR", "Produtos são inativados, não removidos.");
  for (const x of prd.added)
    await ins("INSERT INTO app.products (tenant_id,id,sku,barcode,name,category,unit,price_cents,cost_cents,min_stock,track_stock,active,created_at,ncm,cfop,csosn,origem,cest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [x.id, x.sku, x.barcode ?? null, x.name, x.category, x.unit, x.priceCents, x.costCents, x.minStock, x.trackStock, x.active, x.createdAt, ...fv(x)]);
  for (const { after: x } of prd.changed)
    await ins("UPDATE app.products SET sku=$3, barcode=$4, name=$5, category=$6, unit=$7, price_cents=$8, cost_cents=$9, min_stock=$10, track_stock=$11, active=$12, ncm=$13, cfop=$14, csosn=$15, origem=$16, cest=$17 WHERE tenant_id=$1 AND id=$2", [x.id, x.sku, x.barcode ?? null, x.name, x.category, x.unit, x.priceCents, x.costCents, x.minStock, x.trackStock, x.active, ...fv(x)]);

  const cs = diffBy(before.cashSessions, after.cashSessions, (x) => x.id);
  for (const x of cs.added)
    await ins("INSERT INTO app.cash_sessions (tenant_id,id,opened_at,opened_on,opening_count_cents,closed_at,counted_cents,expected_cents,difference_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [x.id, x.openedAt, x.openedOn, x.openingCountCents, x.closedAt ?? null, x.countedCents ?? null, x.expectedCents ?? null, x.differenceCents ?? null]);
  for (const { after: x } of cs.changed) await ins("UPDATE app.cash_sessions SET closed_at=$3, counted_cents=$4, expected_cents=$5, difference_cents=$6 WHERE tenant_id=$1 AND id=$2", [x.id, x.closedAt ?? null, x.countedCents ?? null, x.expectedCents ?? null, x.differenceCents ?? null]);

  const sal = diffBy(before.sales, after.sales, (x) => x.id);
  if (sal.removed.length) throw new DomainError("VALIDATION_ERROR", "Vendas não podem ser removidas: use devolução.");
  for (const x of sal.added) {
    await ins("INSERT INTO app.sales (tenant_id,id,number,idempotency_key,sale_date,customer_id,cash_session_id,subtotal_cents,discount_cents,total_cents,cash_tendered_cents,change_cents,status,note,created_at,returned_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)", [x.id, x.number, x.idempotencyKey, x.date, x.customerId ?? null, x.cashSessionId ?? null, x.subtotalCents, x.discountCents, x.totalCents, x.cashTenderedCents, x.changeCents, x.status, x.note ?? null, x.createdAt, x.returnedAt ?? null]);
    for (const [i, it] of x.items.entries()) await ins("INSERT INTO app.sale_items (tenant_id,id,sale_id,product_id,name,quantity,unit_price_cents,unit_cost_cents,total_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [`${x.id}:i${String(i).padStart(3, "0")}`, x.id, it.productId, it.name, it.quantity, it.unitPriceCents, it.unitCostCents, it.totalCents]);
    for (const [i, p] of x.payments.entries()) await ins("INSERT INTO app.payments (tenant_id,id,sale_id,method,amount_cents) VALUES ($1,$2,$3,$4,$5)", [`${x.id}:p${String(i).padStart(3, "0")}`, x.id, p.method, p.amountCents]);
  }
  for (const { before: b, after: x } of sal.changed) {
    if (JSON.stringify({ ...b, status: undefined, returnedAt: undefined }) !== JSON.stringify({ ...x, status: undefined, returnedAt: undefined })) throw new DomainError("VALIDATION_ERROR", "Venda concluída só pode mudar de situação.");
    await ins("UPDATE app.sales SET status=$3, returned_at=$4 WHERE tenant_id=$1 AND id=$2", [x.id, x.status, x.returnedAt ?? null]);
  }

  const stk = diffBy(before.stockMovements, after.stockMovements, (x) => x.id);
  appendOnly("estoque", stk);
  for (const x of stk.added) await ins("INSERT INTO app.stock_movements (tenant_id,id,product_id,type,quantity,movement_date,unit_cost_cents,source_id,note,lot,expires_on,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [x.id, x.productId, x.type, x.quantity, x.date, x.unitCostCents ?? null, x.sourceId ?? null, x.note ?? null, x.lot ?? null, x.expiresOn ?? null, x.createdAt]);

  const rev = diffBy(before.revenues, after.revenues, (x) => x.id);
  appendOnly("receitas", rev);
  // Originais antes dos estornos (FK reversal_of).
  for (const x of [...rev.added].sort((a, b) => Number(a.kind === "reversal") - Number(b.kind === "reversal")))
    await ins("INSERT INTO app.revenue_entries (tenant_id,id,kind,competence_date,amount_cents,description,reversal_of,source_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [x.id, x.kind, x.competenceDate, x.amountCents, x.description, x.reversalOf ?? null, x.sourceId ?? null]);

  const mov = diffBy(before.movements, after.movements, (x) => x.id);
  appendOnly("caixa", mov);
  for (const x of [...mov.added].sort((a, b) => Number(!!a.reversalOf) - Number(!!b.reversalOf)))
    await ins("INSERT INTO app.ledger_entries (tenant_id,id,account_id,entry_date,direction,amount_cents,category,description,transfer_id,reversal_of,source_id,cash_session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [x.id, x.accountId, x.date, x.direction, x.amountCents, x.category, x.description, x.transferId ?? null, x.reversalOf ?? null, x.sourceId ?? null, x.sessionId ?? null]);

  const tit = diffBy(before.titles, after.titles, (x) => x.id);
  if (tit.removed.length) throw new DomainError("VALIDATION_ERROR", "Títulos são cancelados, não removidos.");
  const insertTitle = (x: Title) =>
    ins("INSERT INTO app.titles (tenant_id,id,kind,description,customer_id,supplier_id,competence_date,due_date,amount_cents,installment_group,installment_number,installment_count,category,source_id,cancelled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [
      x.id, x.kind, x.description, x.kind === "receivable" ? (x.counterpartyId ?? null) : null, x.kind === "payable" ? (x.counterpartyId ?? null) : null, x.competenceDate, x.dueDate, x.amountCents, x.installment?.groupId ?? null, x.installment?.number ?? null, x.installment?.of ?? null, x.category ?? null, x.sourceId ?? null, x.cancelledAt ?? null,
    ]);
  const insertSettlement = (titleId: string, s: Title["settlements"][number]) => ins("INSERT INTO app.settlements (tenant_id,id,title_id,settled_on,amount_cents,account_id,ledger_entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [s.id, titleId, s.date, s.amountCents, s.accountId, s.movementId]);
  for (const x of tit.added) {
    await insertTitle(x);
    for (const s of x.settlements) await insertSettlement(x.id, s);
  }
  for (const { before: b, after: x } of tit.changed) {
    const prevIds = new Set(b.settlements.map((s) => s.id));
    if (b.settlements.some((s) => !x.settlements.find((y) => y.id === s.id))) throw new DomainError("VALIDATION_ERROR", "Liquidações não podem ser removidas.");
    for (const s of x.settlements) if (!prevIds.has(s.id)) await insertSettlement(x.id, s);
    if (b.cancelledAt !== x.cancelledAt) await ins("UPDATE app.titles SET cancelled_at=$3 WHERE tenant_id=$1 AND id=$2", [x.id, x.cancelledAt ?? null]);
  }

  const das = diffBy(before.dasPayments, after.dasPayments, (x) => x.competence);
  appendOnly("DAS", das);
  for (const x of das.added) await ins("INSERT INTO app.tax_obligations (tenant_id,id,kind,competence,amount_cents,paid_on,proof_note) VALUES ($1,$2,'das',$3,$4,$5,$6)", [`das:${x.competence}`, x.competence, x.amountCents, x.paidOn, x.proofNote ?? null]);

  const fis = diffBy(before.fiscalDocuments, after.fiscalDocuments, (x) => x.id);
  const insertEvents = async (docId: string, evs: FiscalDocument["events"], from: number) => {
    for (let i = from; i < evs.length; i++) {
      const e = evs[i]!;
      await ins("INSERT INTO app.fiscal_events (tenant_id,id,document_id,to_status,protocol,message,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [`${docId}:e${String(i).padStart(3, "0")}`, docId, e.to, e.protocol ?? null, e.message ?? null, e.at]);
    }
  };
  for (const x of fis.added) {
    await ins("INSERT INTO app.fiscal_documents (tenant_id,id,type,sale_id,status,protocol,idempotency_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [x.id, x.type, x.saleId ?? null, x.status, x.protocol ?? null, x.id, x.createdAt]);
    await insertEvents(x.id, x.events, 0);
  }
  for (const { before: b, after: x } of fis.changed) {
    await ins("UPDATE app.fiscal_documents SET status=$3, protocol=$4 WHERE tenant_id=$1 AND id=$2", [x.id, x.status, x.protocol ?? null]);
    await insertEvents(x.id, x.events, b.events.length);
  }

  if (after.fiscal && JSON.stringify(before.fiscal) !== JSON.stringify(after.fiscal)) {
    const f = after.fiscal;
    await ins(
      `INSERT INTO app.fiscal_settings (tenant_id,uf,ie,environment,series,next_number,crt,accreditation_confirmed_at,certificate_configured,csc_configured,accountant_review_name,accountant_review_at,accountant_review_note,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT (tenant_id) DO UPDATE SET uf=EXCLUDED.uf, ie=EXCLUDED.ie, environment=EXCLUDED.environment, series=EXCLUDED.series, next_number=EXCLUDED.next_number, crt=EXCLUDED.crt,
         accreditation_confirmed_at=EXCLUDED.accreditation_confirmed_at, certificate_configured=EXCLUDED.certificate_configured, csc_configured=EXCLUDED.csc_configured,
         accountant_review_name=EXCLUDED.accountant_review_name, accountant_review_at=EXCLUDED.accountant_review_at, accountant_review_note=EXCLUDED.accountant_review_note, updated_at=now()`,
      [f.uf, f.ie ?? null, f.environment, f.series, f.nextNumber, f.crt ?? null, f.accreditationConfirmedAt ?? null, f.certificateConfigured, f.cscConfigured, f.accountantReview?.name ?? null, f.accountantReview?.at ?? null, f.accountantReview?.note ?? null],
    );
  }

  const lnk = diffBy(before.accountantLinks, after.accountantLinks, (x) => x.id);
  for (const x of lnk.added) await ins("INSERT INTO app.accountant_links (tenant_id,id,accountant_name,firm,email,scopes,granted_at,revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [x.id, x.accountantName, x.firm, x.email, x.scopes, x.grantedAt, x.revokedAt ?? null]);
  for (const { after: x } of lnk.changed) await ins("UPDATE app.accountant_links SET revoked_at=$3 WHERE tenant_id=$1 AND id=$2", [x.id, x.revokedAt ?? null]);

  for (const [k, v] of Object.entries(after.idempotency)) {
    if (before.idempotency[k]) continue;
    const i = k.indexOf(":");
    await ins("INSERT INTO app.idempotency_keys (tenant_id,scope,key,resource_id) VALUES ($1,$2,$3,$4)", [k.slice(0, i), k.slice(i + 1), v]);
  }

  // Auditoria: o estado em memória mantém só as últimas entradas; gravamos as novas pelo id.
  const known = new Set(before.audit.map((a) => a.id));
  for (const a of after.audit) if (!known.has(a.id)) await ins("INSERT INTO app.audit_logs (tenant_id,id,actor_user_id,action,entity,entity_id,details,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [a.id, a.actor, a.action, a.entity, a.entityId, a.details ?? null, a.at]);
}
