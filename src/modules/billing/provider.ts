import { DomainError } from "@/lib/errors";

/** Assinatura do SaaS (Fluxora → lojista). Separada das cobranças do lojista aos clientes dele. */
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";

export interface BillingProvider {
  readonly id: string;
  readonly configured: boolean;
  createCheckout(params: { tenantId: string; planId: string; idempotencyKey: string }): Promise<{ checkoutUrl: string }>;
  /** Valida assinatura do webhook server-to-server antes de qualquer processamento. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<boolean>;
}

export class DisabledBillingProvider implements BillingProvider {
  readonly id = "disabled";
  readonly configured = false;
  async createCheckout(): Promise<{ checkoutUrl: string }> {
    throw new DomainError("BILLING_PROVIDER_NOT_CONFIGURED", "Cobrança não configurada. Piloto gratuito até formalização.");
  }
  async verifyWebhook(_rawBody?: string, _signature?: string | null): Promise<boolean> {
    void _rawBody;
    void _signature;
    return false;
  }
}

export const PLANS = [
  { id: "gestao", name: "Gestão", priceCents: 1990, description: "Vendas, caixa, estoque, clientes e Meu MEI." },
  { id: "fiscal", name: "Fiscal", priceCents: 3490, description: "Gestão + emissão fiscal (condicionado ao custo por documento)." },
  { id: "comercio", name: "Comércio", priceCents: 5990, description: "Fiscal + franquia ampliada para comércio." },
] as const;
