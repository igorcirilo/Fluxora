import { DomainError } from "@/lib/errors";

/**
 * Datas comerciais são strings ISO `YYYY-MM-DD` no fuso America/Sao_Paulo.
 * Timestamps técnicos (createdAt) são UTC ISO-8601.
 */
export type BizDate = string;

export const BUSINESS_TZ = "America/Sao_Paulo";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertBizDate(value: string): BizDate {
  const m = ISO_DATE.exec(value);
  if (!m) throw new DomainError("INVALID_DATE", "Data inválida.");
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) {
    throw new DomainError("INVALID_DATE", "Data inválida.");
  }
  return value;
}

/** Data comercial de hoje em São Paulo, independente do fuso do servidor/navegador. */
export function todayBiz(now: Date = new Date()): BizDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA já produz YYYY-MM-DD
}

export function parts(d: BizDate): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(assertBizDate(d))!;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function makeBizDate(year: number, month: number, day: number): BizDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(d: BizDate, days: number): BizDate {
  const { year, month, day } = parts(d);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return makeBizDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = domingo … 6 = sábado */
export function weekday(d: BizDate): number {
  const { year, month, day } = parts(d);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function monthStart(year: number, month: number): BizDate {
  return makeBizDate(year, month, 1);
}

export function nextMonthStart(year: number, month: number): BizDate {
  return month === 12 ? makeBizDate(year + 1, 1, 1) : makeBizDate(year, month + 1, 1);
}

export function compareBiz(a: BizDate, b: BizDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function monthLabel(month: number, long = false): string {
  return (long ? MONTHS_LONG : MONTHS)[month - 1] ?? "";
}

export function formatBizDate(d: BizDate): string {
  const { year, month, day } = parts(d);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

export function formatBizDateShort(d: BizDate): string {
  const { month, day } = parts(d);
  return `${String(day).padStart(2, "0")} ${monthLabel(month)}`;
}
