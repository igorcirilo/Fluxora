"use client";
import { useState } from "react";
import { formatBRL, formatBRLCompact } from "@/modules/finance/money";
import { cn } from "./cn";

/** Gráfico de barras agrupadas em SVG puro (sem biblioteca: bundle leve). */
export function BarChart({ labels, series, height = 200, className }: { labels: string[]; series: { name: string; values: number[]; color: string }[]; height?: number; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = niceMax(max);
  const w = 100 / labels.length;
  return (
    <div className={cn("w-full", className)}>
      <div className="relative" style={{ height }}>
        {[0, 0.5, 1].map((t) => (
          <div key={t} className="absolute right-0 left-0 border-t border-dashed border-line" style={{ bottom: `${t * 100}%` }}>
            <span className="absolute -top-2.5 left-0 bg-surface pr-1 text-[10.5px] text-subtle tabular">{formatBRLCompact(Math.round(nice * t))}</span>
          </div>
        ))}
        <div className="absolute inset-0 left-12 flex items-end">
          {labels.map((label, i) => (
            <div
              key={label + i}
              className="relative flex h-full items-end justify-center gap-[3px] px-[3px]"
              style={{ width: `${w}%` }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover((h) => (h === i ? null : i))}
            >
              {series.map((s) => (
                <div
                  key={s.name}
                  className="w-full max-w-[18px] rounded-t-[5px] transition-[height,opacity] duration-500"
                  style={{ height: `${(Math.max(0, s.values[i] ?? 0) / nice) * 100}%`, background: s.color, opacity: hover === null || hover === i ? 1 : 0.45 }}
                />
              ))}
              {hover === i ? (
                <div className="animate-in absolute bottom-full z-20 mb-2 w-max rounded-xl border border-line bg-elevated px-3 py-2 text-[12px] shadow-pop">
                  <div className="mb-1 font-medium">{label}</div>
                  {series.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}: <span className="font-medium text-fg tabular">{formatBRL(s.values[i] ?? 0)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 ml-12 flex">
        {labels.map((l, i) => (
          <div key={l + i} className="truncate text-center text-[10.5px] text-subtle" style={{ width: `${w}%` }}>
            {l}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * exp;
}

/** Medidor semicircular do limite MEI. */
export function Gauge({ valueBp, color, children, size = 220 }: { valueBp: number; color: string; children?: React.ReactNode; size?: number }) {
  const pct = Math.max(0, Math.min(1, valueBp / 10_000));
  const r = 80;
  const c = Math.PI * r;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 200 120" className="h-full w-full" aria-hidden>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--surface-2)" strokeWidth="16" strokeLinecap="round" />
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: "stroke-dasharray .8s ease" }}
        />
        {[0.8, 0.9].map((t) => {
          const a = Math.PI * (1 - t);
          return (
            <line
              key={t}
              x1={100 + 66 * Math.cos(a)}
              y1={100 - 66 * Math.sin(a)}
              x2={100 + 94 * Math.cos(a)}
              y2={100 - 94 * Math.sin(a)}
              stroke="var(--fg-subtle)"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">{children}</div>
    </div>
  );
}

export function Sparkline({ values, color = "var(--brand)", className }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
