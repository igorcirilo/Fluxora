"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "./cn";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const Ctx = createContext<(kind: ToastKind, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:right-6 sm:bottom-6 sm:left-auto sm:items-end" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-in pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border bg-elevated px-3.5 py-2.5 text-[13.5px] shadow-pop",
              t.kind === "error" ? "border-danger/30" : "border-line",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={18} className="mt-px shrink-0 text-accent" />
            ) : t.kind === "error" ? (
              <AlertTriangle size={18} className="mt-px shrink-0 text-danger" />
            ) : (
              <Info size={18} className="mt-px shrink-0 text-info" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
