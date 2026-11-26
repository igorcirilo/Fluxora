import { DomainError } from "@/lib/errors";
import type { Cents } from "@/modules/finance/money";

/**
 * Regras parametrizadas por regime e vigência. Espelham a tabela `tax_rules`.
 * Valores DEVEM ser revisados por contador antes de cada exercício.
 * Fonte de referência da documentação do projeto (seção 3): MEI comum R$ 81.000/ano,
 * proporcional a R$ 6.750 por mês de atividade no ano de abertura (incluindo o mês de abertura).
 */
export type MeiRegime = "mei-geral" | "mei-caminhoneiro";

export interface TaxRule {
  id: string;
  regime: MeiRegime;
  validFrom: number; // ano-calendário inicial (inclusive)
  validTo: number | null; // ano-calendário final (inclusive) ou aberto
  annualLimitCents: Cents;
  /** Limiares gerenciais em pontos-base (8000 = 80%). */
  alertThresholdsBp: readonly number[];
  /** Tolerância de excesso em pontos-base que separa "até 20%" de "acima de 20%". */
  excessToleranceBp: number;
  reference: string;
  reviewedAt: string;
  requiresAccountantReview: boolean;
}

export const TAX_RULES: readonly TaxRule[] = [
  {
    id: "mei-geral-v1",
    regime: "mei-geral",
    validFrom: 2018,
    validTo: null,
    annualLimitCents: 8_100_000,
    alertThresholdsBp: [8000, 9000, 10000],
    excessToleranceBp: 2000,
    reference: "Documentação Fluxora v0.1, seção 3 (LC 123/2006 — confirmar redação vigente)",
    reviewedAt: "2026-11-26",
    requiresAccountantReview: true,
  },
];

export const SUPPORTED_REGIMES: readonly MeiRegime[] = ["mei-geral"];

export function resolveRule(regime: MeiRegime, year: number, rules: readonly TaxRule[] = TAX_RULES): TaxRule {
  if (!SUPPORTED_REGIMES.includes(regime)) {
    throw new DomainError("REGIME_NOT_SUPPORTED", "Regime ainda não suportado. MEI caminhoneiro possui regras próprias.");
  }
  const rule = rules.find((r) => r.regime === regime && r.validFrom <= year && (r.validTo === null || r.validTo >= year));
  if (!rule) throw new DomainError("RULE_NOT_FOUND", `Nenhuma regra vigente para ${regime} em ${year}.`);
  return rule;
}
