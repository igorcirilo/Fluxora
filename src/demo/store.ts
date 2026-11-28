import { z } from "zod";
import { DomainError, isDomainError } from "@/lib/errors";
import { makeCtx, type Ctx, type TenantState } from "@/modules/tenants/state";
import { todayBiz } from "@/modules/finance/dates";
import { DEMO_TENANT_A, DEMO_TENANT_B, blankTenant, seedDoceria, seedStudio } from "./seed";

/**
 * Store do MODO DEMONSTRAÇÃO. Persistência apenas no navegador (localStorage), dados fictícios.
 * Não é o backend de produção: substitui-se pelo repositório PostgreSQL (RLS) sem mudar o domínio.
 * Isolamento: toda operação resolve o tenant pela sessão e verifica membership antes de tocar dados.
 */
export interface DemoUser {
  id: string;
  name: string;
  role: "owner" | "operator" | "accountant";
}

export interface Membership {
  userId: string;
  tenantId: string;
  role: "owner" | "operator" | "accountant";
}

export interface DemoDb {
  version: number;
  tenants: Record<string, TenantState>;
  users: DemoUser[];
  memberships: Membership[];
  session: { userId: string; tenantId: string } | null;
}

export const DB_VERSION = 6;
export const STORAGE_KEY = "fluxora.demo.v5";

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export type OpResult<T = void> = { ok: true; value: T } | { ok: false; code: string; message: string };

export function freshDb(today = todayBiz()): DemoDb {
  return {
    version: DB_VERSION,
    tenants: { [DEMO_TENANT_A]: seedDoceria(today), [DEMO_TENANT_B]: seedStudio(today) },
    users: [
      { id: "usr_ana", name: "Ana (titular fictícia)", role: "owner" },
      { id: "usr_bruno", name: "Bruno (titular fictício)", role: "owner" },
      { id: "usr_monica", name: "Mônica (contadora fictícia)", role: "accountant" },
    ],
    memberships: [
      { userId: "usr_ana", tenantId: DEMO_TENANT_A, role: "owner" },
      { userId: "usr_bruno", tenantId: DEMO_TENANT_B, role: "owner" },
      { userId: "usr_monica", tenantId: DEMO_TENANT_A, role: "accountant" },
      { userId: "usr_monica", tenantId: DEMO_TENANT_B, role: "accountant" },
    ],
    session: null,
  };
}

export class DemoStore {
  private db: DemoDb | null = null;
  private listeners = new Set<() => void>();
  persistError: string | null = null;

  constructor(
    private storage: KeyValueStorage | null,
    private clock: () => Date = () => new Date(),
  ) {}

  load(): DemoDb {
    if (this.db) return this.db;
    let parsed: DemoDb | null = null;
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw) as DemoDb;
    } catch {
      parsed = null;
    }
    this.db = parsed && parsed.version === DB_VERSION ? parsed : freshDb(todayBiz(this.clock()));
    if (!parsed) this.persist();
    return this.db;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): DemoDb => this.load();

  private commit(next: DemoDb) {
    this.db = next;
    this.persist();
    for (const l of this.listeners) l();
  }

  private persist() {
    if (!this.db || !this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.db));
      this.persistError = null;
    } catch {
      this.persistError = "Armazenamento do navegador indisponível: alterações valem só nesta aba.";
    }
  }

  ctx(actor?: string): Ctx {
    const now = this.clock();
    return makeCtx({ now, today: todayBiz(now), actor: actor ?? this.load().session?.userId ?? "anon" });
  }

  /** Verifica membership ANTES de expor o tenant (equivalente ao set_config após checagem). */
  private assertMember(db: DemoDb, userId: string, tenantId: string): Membership {
    const m = db.memberships.find((x) => x.userId === userId && x.tenantId === tenantId);
    if (!m || !db.tenants[tenantId]) throw new DomainError("TENANT_ACCESS_DENIED", "Acesso negado a esta empresa.");
    return m;
  }

  login(userId: string, tenantId?: string): OpResult {
    const db = this.load();
    const target = tenantId ?? db.memberships.find((m) => m.userId === userId)?.tenantId;
    try {
      if (!target) throw new DomainError("TENANT_ACCESS_DENIED", "Usuário sem empresa.");
      this.assertMember(db, userId, target);
      this.commit({ ...db, session: { userId, tenantId: target } });
      return { ok: true, value: undefined };
    } catch (e) {
      return toErr(e);
    }
  }

  logout() {
    this.commit({ ...this.load(), session: null });
  }

  createBlankTenant(params: { tradeName: string; openedOn: string; segment: "comercio" | "servicos" | "misto"; ownerName: string }): OpResult<string> {
    const db = this.load();
    const name = params.tradeName.trim();
    if (!name || name.length > 80) return { ok: false, code: "VALIDATION_ERROR", message: "Informe o nome fantasia (até 80 caracteres)." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.openedOn) || params.openedOn > todayBiz(this.clock())) return { ok: false, code: "INVALID_DATE", message: "Data de abertura inválida." };
    const id = `tnt_${crypto.randomUUID().slice(0, 8)}`;
    const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    this.commit({
      ...db,
      tenants: { ...db.tenants, [id]: blankTenant({ id, tradeName: name, openedOn: params.openedOn, segment: params.segment }) },
      users: [...db.users, { id: userId, name: params.ownerName.trim() || "Titular", role: "owner" }],
      memberships: [...db.memberships, { userId, tenantId: id, role: "owner" }],
      session: { userId, tenantId: id },
    });
    return { ok: true, value: id };
  }

  /** Estado do tenant da sessão atual (somente após checagem de membership). */
  current(): TenantState | null {
    const db = this.load();
    if (!db.session) return null;
    try {
      this.assertMember(db, db.session.userId, db.session.tenantId);
      return db.tenants[db.session.tenantId]!;
    } catch {
      return null;
    }
  }

  /** Executa uma operação de domínio como transação: tudo ou nada, apenas no tenant da sessão. */
  run<T = void>(op: (state: TenantState, ctx: Ctx) => TenantState | { state: TenantState; value: T }): OpResult<T> {
    const db = this.load();
    try {
      if (!db.session) throw new DomainError("TENANT_ACCESS_DENIED", "Sessão expirada.");
      const { userId, tenantId } = db.session;
      const m = this.assertMember(db, userId, tenantId);
      if (m.role === "accountant") throw new DomainError("TENANT_ACCESS_DENIED", "Acesso de contador é somente leitura.");
      const out = op(db.tenants[tenantId]!, this.ctx(userId));
      const next = "state" in out && "value" in out ? out : { state: out as TenantState, value: undefined as T };
      if (next.state.tenant.id !== tenantId) throw new DomainError("TENANT_ACCESS_DENIED", "Operação tentou alterar outra empresa.");
      this.commit({ ...db, tenants: { ...db.tenants, [tenantId]: next.state } });
      return { ok: true, value: next.value };
    } catch (e) {
      return toErr(e);
    }
  }

  /** Papel do usuário da sessão na empresa ativa. */
  currentRole(): Membership["role"] | null {
    const db = this.load();
    if (!db.session) return null;
    return db.memberships.find((m) => m.userId === db.session!.userId && m.tenantId === db.session!.tenantId)?.role ?? null;
  }

  /** Empresas em que o usuário da sessão é contador (somente leitura). */
  accountantClients(): TenantState[] {
    const db = this.load();
    if (!db.session) return [];
    return db.memberships.filter((m) => m.userId === db.session!.userId && m.role === "accountant").map((m) => db.tenants[m.tenantId]!).filter(Boolean);
  }

  /** Exportação (portabilidade/LGPD) restrita ao tenant da sessão. */
  exportCurrent(): OpResult<string> {
    const s = this.current();
    if (!s) return { ok: false, code: "TENANT_ACCESS_DENIED", message: "Sem sessão." };
    return { ok: true, value: JSON.stringify({ exportedAt: this.clock().toISOString(), notice: "Dados fictícios — modo demonstração", data: s }, null, 2) };
  }

  reset() {
    const session = this.load().session;
    const fresh = freshDb(todayBiz(this.clock()));
    const keep = session && fresh.memberships.some((m) => m.userId === session.userId && m.tenantId === session.tenantId);
    this.commit({ ...fresh, session: keep ? session : null });
  }
}

function toErr(e: unknown): { ok: false; code: string; message: string } {
  if (isDomainError(e)) return { ok: false, code: e.code, message: e.message };
  if (e instanceof z.ZodError) return { ok: false, code: "VALIDATION_ERROR", message: `Dados inválidos: ${e.issues.map((i) => i.path.join(".") || i.message).join(", ")}` };
  return { ok: false, code: "UNEXPECTED", message: "Erro inesperado. Tente novamente." };
}
