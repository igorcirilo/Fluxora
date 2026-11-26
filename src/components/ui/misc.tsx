"use client";
import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "./cn";

export function EmptyState({ icon, title, description, action, className }: { icon: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13.5px] text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} />;
}

/** Dica de definição: todo indicador mostra período e definição (requisito do dashboard). */
export function InfoTip({ text, label = "O que é isto?" }: { text: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} onBlur={() => setOpen(false)} className="rounded-full p-0.5 text-subtle hover:text-fg">
        <Info size={14} />
      </button>
      {open ? (
        <span
          role="tooltip"
          className="animate-in absolute top-6 right-0 z-30 w-64 rounded-xl border border-line bg-elevated p-3 text-left text-[12.5px] leading-relaxed font-normal text-muted shadow-pop sm:left-0 sm:right-auto"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function Progress({ valueBp, tone = "brand", className }: { valueBp: number; tone?: "brand" | "success" | "warn" | "danger"; className?: string }) {
  const pct = Math.max(0, Math.min(100, valueBp / 100));
  const color = { brand: "bg-brand", success: "bg-accent", warn: "bg-warn", danger: "bg-danger" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-[13.5px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <div className={cn("relative", className)}>
      <svg
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-line-strong bg-elevated pr-3 pl-9 text-[15px] placeholder:text-subtle focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none sm:h-10 sm:text-sm"
      />
    </div>
  );
}
