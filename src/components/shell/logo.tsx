"use client";
import { useId } from "react";

export function Logo({ className = "", withText = true, light = false }: { className?: string; withText?: boolean; light?: boolean }) {
  const gid = `fx-g-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8a80ff" />
            <stop offset="1" stopColor="#12b886" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#151140" />
        <path d="M16 40c8 0 10-16 18-16s8 10 14 10" fill="none" stroke={`url(#${gid})`} strokeWidth="6" strokeLinecap="round" />
        <circle cx="48" cy="34" r="4" fill="#6ee7c4" />
      </svg>
      {withText ? <span className={`text-[17px] font-semibold tracking-tight ${light ? "text-white" : "text-fg"}`}>Fluxora</span> : null}
    </span>
  );
}
