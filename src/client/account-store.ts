"use client";
import type { TenantState } from "@/modules/tenants/state";
import type { OpResult } from "@/demo/store";

export interface AccountSnapshot {
  status: "idle" | "loading" | "anon" | "no-tenant" | "ready" | "disabled" | "error";
  user: { id: string; name: string; email: string } | null;
  tenants: { id: string; tradeName: string; role: string }[];
  activeTenantId: string | null;
  state: TenantState | null;
  error?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? "Falha na comunicação com o servidor."), { code: body?.error?.code ?? `HTTP_${res.status}` });
  return body as T;
}

/** Estado do MODO CONTA no cliente: espelho do servidor (fonte da verdade = PostgreSQL). */
export class AccountStore {
  private snap: AccountSnapshot = { status: "idle", user: null, tenants: [], activeTenantId: null, state: null };
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(p: Partial<AccountSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  ensureLoaded() {
    if (this.snap.status === "idle") void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.set({ status: this.snap.state ? this.snap.status : "loading" });
    this.inflight = (async () => {
      try {
        const s = await json<{ enabled: boolean; user: AccountSnapshot["user"]; tenants?: AccountSnapshot["tenants"]; activeTenantId?: string | null }>(await fetch("/api/app/session", { cache: "no-store" }));
        if (!s.enabled) return this.set({ status: "disabled", user: null, state: null });
        if (!s.user) return this.set({ status: "anon", user: null, tenants: [], activeTenantId: null, state: null });
        if (!s.activeTenantId) return this.set({ status: "no-tenant", user: s.user, tenants: s.tenants ?? [], activeTenantId: null, state: null });
        const st = await json<{ state: TenantState }>(await fetch("/api/app/state", { cache: "no-store" }));
        this.set({ status: "ready", user: s.user, tenants: s.tenants ?? [], activeTenantId: s.activeTenantId, state: st.state });
      } catch (e) {
        this.set({ status: "error", error: e instanceof Error ? e.message : "Erro" });
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async exec(name: string, input: unknown): Promise<OpResult<unknown>> {
    try {
      const out = await json<{ value: unknown; state: TenantState }>(await fetch("/api/app/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, input }) }));
      this.set({ state: out.state });
      return { ok: true, value: out.value };
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "TENANT_ACCESS_DENIED") void this.refresh();
      return { ok: false, code: err.code ?? "UNEXPECTED", message: err.message };
    }
  }

  async createTenant(input: { tradeName: string; openedOn: string; segment: string }): Promise<OpResult<string>> {
    try {
      const r = await json<{ id: string }>(await fetch("/api/app/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
      await this.refresh();
      return { ok: true, value: r.id };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { ok: false, code: err.code ?? "UNEXPECTED", message: err.message };
    }
  }

  async selectTenant(tenantId: string) {
    await fetch("/api/app/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }) });
    this.set({ state: null });
    await this.refresh();
  }

  async invites(): Promise<{ tenantId: string; linkId: string; companyLabel: string; scopes: string[]; grantedAt: string; expiresAt: string }[]> {
    const r = await json<{ invites: never[] }>(await fetch("/api/accountant/invites", { cache: "no-store" }));
    return r.invites;
  }

  async acceptInvite(tenantId: string, linkId: string, code: string): Promise<OpResult<void>> {
    try {
      await json(await fetch("/api/accountant/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, linkId, code }) }));
      await this.refresh();
      return { ok: true, value: undefined };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { ok: false, code: err.code ?? "UNEXPECTED", message: err.message };
    }
  }

  async clients<T>(): Promise<T[]> {
    const r = await json<{ clients: T[] }>(await fetch("/api/accountant/clients", { cache: "no-store" }));
    return r.clients;
  }

  async signOut() {
    await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    this.set({ status: "anon", user: null, tenants: [], activeTenantId: null, state: null });
  }
}
