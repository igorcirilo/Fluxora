"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

/**
 * Modal acessível: bottom-sheet no celular, diálogo central no desktop.
 * Fecha com Esc e clique no fundo; trava a rolagem; foca o painel ao abrir.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-elevated shadow-pop outline-none sm:animate-in sm:rounded-2xl",
          size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3 sm:pt-5">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
            {description ? <div className="mt-0.5 text-[13px] text-muted">{description}</div> : null}
          </div>
          <button onClick={onClose} className="-mr-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="pb-safe flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}
