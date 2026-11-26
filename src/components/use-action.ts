"use client";
import { useCallback } from "react";
import { useToast } from "@/components/ui";
import { useTenant } from "@/demo/use-demo";
import type { Ctx, TenantState } from "@/modules/tenants/state";

/** Executa uma operação de domínio no tenant da sessão e mostra feedback. */
export function useAction() {
  const t = useTenant();
  const toast = useToast();
  return useCallback(
    <T>(op: (s: TenantState, c: Ctx) => TenantState | { state: TenantState; value: T }, success?: string): { ok: true; value: T } | { ok: false; message: string } => {
      if (!t) return { ok: false, message: "Sessão expirada." };
      const r = t.run<T>(op);
      if (r.ok) {
        if (success) toast("success", success);
        return { ok: true, value: r.value };
      }
      toast("error", r.message);
      return { ok: false, message: r.message };
    },
    [t, toast],
  );
}

export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function safeParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
