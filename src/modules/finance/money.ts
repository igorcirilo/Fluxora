import { DomainError } from "@/lib/errors";

/**
 * Valores monetários são SEMPRE centavos inteiros.
 * No PostgreSQL usamos `bigint`; no JavaScript, inteiros seguros (até ~R$ 90 trilhões),
 * validados em toda entrada. Nunca usar float para somar dinheiro.
 */
export type Cents = number;

export const MAX_AMOUNT_CENTS = 100_000_000_000; // R$ 1 bilhão por lançamento (mesmo teto do protótipo)

export function assertCents(value: number, { allowZero = false } = {}): Cents {
  if (!Number.isSafeInteger(value)) throw new DomainError("INVALID_AMOUNT", "Valor deve ser inteiro em centavos.");
  if (value < 0 || (!allowZero && value === 0)) throw new DomainError("INVALID_AMOUNT", "Valor deve ser positivo.");
  if (value > MAX_AMOUNT_CENTS) throw new DomainError("INVALID_AMOUNT", "Valor acima do limite permitido.");
  return value;
}

/**
 * Converte texto digitado ("12,34", "1.234,56", "12.34") em centavos, sem float.
 * Rejeita NaN, Infinity, negativos, mais de 2 casas e zero (equivalente a `cents()` do protótipo).
 */
export function parseCents(input: string | number, { allowZero = false } = {}): Cents {
  let s = String(input).trim().replace(/^R\$\s*/i, "");
  if (s === "") throw new DomainError("INVALID_AMOUNT", "Valor inválido.");
  // Formato brasileiro com vírgula decimal: remove separador de milhar.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new DomainError("INVALID_AMOUNT", "Valor inválido.");
  const [intPart, frac = ""] = s.split(".") as [string, string?];
  const normalizedInt = intPart.replace(/^0+(?=\d)/, "");
  if (normalizedInt.length > 12) throw new DomainError("INVALID_AMOUNT", "Valor acima do limite permitido.");
  const cents = Number(normalizedInt) * 100 + Number((frac ?? "").padEnd(2, "0"));
  return assertCents(cents, { allowZero });
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100).replace(/ /g, " ");
}

/** Formato compacto para gráficos: R$ 12,3 mil */
export function formatBRLCompact(cents: Cents): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatBRL(cents);
}

export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  if (!Number.isSafeInteger(total)) throw new DomainError("INVALID_AMOUNT", "Soma excede a precisão segura.");
  return total;
}

/** Percentual em pontos-base (1% = 100) com arredondamento para baixo, sem float acumulado. */
export function basisPoints(part: Cents, whole: Cents): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10_000) / whole);
}
