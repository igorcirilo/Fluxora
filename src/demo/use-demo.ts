"use client";
import { useCallback, useSyncExternalStore } from "react";
import { DemoStore, type DemoDb, type OpResult } from "./store";
import type { Ctx, TenantState } from "@/modules/tenants/state";

let singleton: DemoStore | null = null;

export function getStore(): DemoStore | null {
  if (typeof window === "undefined") return null;
  if (!singleton) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    singleton = new DemoStore(storage);
  }
  return singleton;
}

const noop = () => () => {};

export function useDemoDb(): DemoDb | null {
  const store = getStore();
  return useSyncExternalStore(store ? store.subscribe : noop, store ? store.getSnapshot : () => null, () => null);
}

export interface TenantApi {
  db: DemoDb;
  state: TenantState;
  userName: string;
  run: <T = void>(op: (s: TenantState, c: Ctx) => TenantState | { state: TenantState; value: T }) => OpResult<T>;
}

/** Acesso ao tenant da sessão. Retorna null enquanto carrega ou sem sessão. */
export function useTenant(): TenantApi | null {
  const db = useDemoDb();
  const store = getStore();
  const run = useCallback(<T>(op: (s: TenantState, c: Ctx) => TenantState | { state: TenantState; value: T }) => store!.run<T>(op), [store]);
  if (!db || !db.session || !store) return null;
  const state = db.tenants[db.session.tenantId];
  if (!state || !db.memberships.some((m) => m.userId === db.session!.userId && m.tenantId === db.session!.tenantId)) return null;
  const userName = db.users.find((u) => u.id === db.session!.userId)?.name ?? "Titular";
  return { db, state, userName, run };
}
