"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { DemoStore, type DemoDb, type OpResult } from "./store";
import { AccountStore, type AccountSnapshot } from "@/client/account-store";
import { runCommand, type CommandInput, type CommandName } from "@/modules/commands";
import type { TenantState } from "@/modules/tenants/state";

/**
 * Fonte de dados da interface. Dois modos com a MESMA API e os MESMOS comandos:
 * - "demo": DemoStore no navegador (dados fictícios);
 * - "conta": AccountStore → /api/app/* → PostgreSQL com RLS.
 */
export type AppMode = "demo" | "conta";
const MODE_KEY = "fluxora.mode";

let demo: DemoStore | null = null;
let account: AccountStore | null = null;

export function getStore(): DemoStore | null {
  if (typeof window === "undefined") return null;
  if (!demo) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    demo = new DemoStore(storage);
  }
  return demo;
}

export function getAccountStore(): AccountStore | null {
  if (typeof window === "undefined") return null;
  if (!account) account = new AccountStore();
  return account;
}

const modeListeners = new Set<() => void>();
export function getMode(): AppMode {
  try {
    return localStorage.getItem(MODE_KEY) === "conta" ? "conta" : "demo";
  } catch {
    return "demo";
  }
}
export function setMode(m: AppMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* preferência só nesta aba */
  }
  for (const l of modeListeners) l();
}
export function useMode(): AppMode | null {
  return useSyncExternalStore(
    (fn) => {
      modeListeners.add(fn);
      return () => modeListeners.delete(fn);
    },
    getMode,
    () => null,
  );
}

const noop = () => () => {};

export function useDemoDb(): DemoDb | null {
  const store = getStore();
  return useSyncExternalStore(store ? store.subscribe : noop, store ? store.getSnapshot : () => null, () => null);
}

const EMPTY: AccountSnapshot = { status: "idle", user: null, tenants: [], activeTenantId: null, state: null };
export function useAccount(enabled: boolean): AccountSnapshot {
  const store = getAccountStore();
  const snap = useSyncExternalStore(store && enabled ? store.subscribe : noop, store && enabled ? store.getSnapshot : () => EMPTY, () => EMPTY);
  useEffect(() => {
    if (enabled) store?.ensureLoaded();
  }, [enabled, store]);
  return snap;
}

export type Exec = <K extends CommandName>(name: K, input: CommandInput<K>) => Promise<OpResult<unknown>>;

export type Role = "owner" | "operator" | "accountant";

export interface TenantApi {
  mode: AppMode;
  state: TenantState;
  userName: string;
  role: Role;
  /** Empresas em que o usuário é contador (para o portal). */
  hasAccountantAccess: boolean;
  exec: Exec;
}

/** Status do carregamento para o shell decidir entre conteúdo, carregamento ou redirecionamento. */
export function useAppStatus(): { mode: AppMode | null; status: "loading" | "ready" | "redirect-demo" | AccountSnapshot["status"] } {
  const mode = useMode();
  const db = useDemoDb();
  const acc = useAccount(mode === "conta");
  if (mode === null) return { mode, status: "loading" };
  if (mode === "demo") {
    if (!db) return { mode, status: "loading" };
    const ok = db.session && db.memberships.some((m) => m.userId === db.session!.userId && m.tenantId === db.session!.tenantId) && db.tenants[db.session.tenantId];
    return { mode, status: ok ? "ready" : "redirect-demo" };
  }
  return { mode, status: acc.status === "idle" ? "loading" : acc.status };
}

export function useTenant(): TenantApi | null {
  const mode = useMode();
  const db = useDemoDb();
  const acc = useAccount(mode === "conta");
  const exec = useCallback<Exec>(
    async (name, input) => {
      if (getMode() === "conta") return getAccountStore()!.exec(name, input);
      const r = getStore()!.run<unknown>((s, c) => runCommand(name, input, s, c));
      if (!r.ok && r.code === "UNEXPECTED") return r;
      return r;
    },
    [],
  );
  if (mode === "conta") {
    if (acc.status !== "ready" || !acc.state || !acc.user) return null;
    const role = (acc.tenants.find((x) => x.id === acc.activeTenantId)?.role ?? "owner") as Role;
    return { mode, state: acc.state, userName: acc.user.name, role, hasAccountantAccess: acc.tenants.some((x) => x.role === "accountant"), exec };
  }
  if (!db || !db.session) return null;
  const state = db.tenants[db.session.tenantId];
  if (!state || !db.memberships.some((m) => m.userId === db.session!.userId && m.tenantId === db.session!.tenantId)) return null;
  const userName = db.users.find((u) => u.id === db.session!.userId)?.name ?? "Titular";
  const mine = db.memberships.filter((m) => m.userId === db.session!.userId);
  const role = (mine.find((m) => m.tenantId === db.session!.tenantId)?.role ?? "owner") as Role;
  return { mode: "demo", state, userName, role, hasAccountantAccess: mine.some((m) => m.role === "accountant"), exec };
}

export function isZodError(e: unknown): e is z.ZodError {
  return e instanceof z.ZodError;
}
