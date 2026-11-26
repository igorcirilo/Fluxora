import type { CashAccount, CashMovement } from "@/modules/finance/cash";
import type { Title } from "@/modules/finance/titles";
import type { Product, StockMovement } from "@/modules/inventory/stock";
import type { Customer, Supplier } from "@/modules/customers/customer";
import type { RevenueEntry } from "@/modules/mei/revenue";
import type { MeiRegime } from "@/modules/mei/rules";
import type { DasPaymentRecord } from "@/modules/mei/calendar";
import type { FiscalDocument } from "@/modules/fiscal/provider";
import type { AccountantLink } from "@/modules/accounting/links";
import type { Sale, CashSession } from "@/modules/sales/types";
import type { BizDate } from "@/modules/finance/dates";

export interface Tenant {
  id: string;
  name: string; // razão social / nome empresarial
  tradeName: string; // nome fantasia
  openedOn: BizDate;
  regime: MeiRegime;
  segment: "comercio" | "servicos" | "misto";
  city: string;
  uf: string;
  allowNegativeStock: boolean;
  isDemo: boolean;
}

export interface AuditEntry {
  id: string;
  at: string; // UTC
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  details?: string;
}

/**
 * Agregado de dados de UM tenant. Espelha as tabelas com `tenant_id` no PostgreSQL.
 * Operações de domínio são funções puras (estado → novo estado), equivalentes a uma transação.
 */
export interface TenantState {
  tenant: Tenant;
  accounts: CashAccount[];
  products: Product[];
  stockMovements: StockMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  revenues: RevenueEntry[];
  movements: CashMovement[];
  titles: Title[];
  cashSessions: CashSession[];
  dasPayments: DasPaymentRecord[];
  fiscalDocuments: FiscalDocument[];
  accountantLinks: AccountantLink[];
  audit: AuditEntry[];
  /** chave idempotente (tenant/operação) → id do recurso criado */
  idempotency: Record<string, string>;
  seq: { sale: number };
}

export const ACCOUNT_DRAWER = "acc-caixa";
export const ACCOUNT_BANK = "acc-banco";

export interface Ctx {
  nowIso: string;
  today: BizDate;
  actor: string;
  newId: (prefix: string) => string;
}

export function audit(state: TenantState, ctx: Ctx, action: string, entity: string, entityId: string, details?: string): AuditEntry {
  return { id: ctx.newId("aud"), at: ctx.nowIso, actor: ctx.actor, action, entity, entityId, details };
}

export function emptyTenantState(tenant: Tenant): TenantState {
  return {
    tenant,
    accounts: [
      { id: ACCOUNT_DRAWER, name: "Caixa (gaveta)", kind: "cash_drawer" },
      { id: ACCOUNT_BANK, name: "Conta PJ", kind: "bank" },
    ],
    products: [],
    stockMovements: [],
    customers: [],
    suppliers: [],
    sales: [],
    revenues: [],
    movements: [],
    titles: [],
    cashSessions: [],
    dasPayments: [],
    fiscalDocuments: [],
    accountantLinks: [],
    audit: [],
    idempotency: {},
    seq: { sale: 0 },
  };
}

export function makeCtx(params: { now?: Date; today?: BizDate; actor?: string; idPrefix?: string } = {}): Ctx {
  let n = 0;
  const now = params.now ?? new Date();
  return {
    nowIso: now.toISOString(),
    today: params.today ?? now.toISOString().slice(0, 10),
    actor: params.actor ?? "sistema",
    newId: (prefix) => {
      n += 1;
      const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
      return `${prefix}_${params.idPrefix ?? ""}${rnd}${n.toString(36)}`;
    },
  };
}
