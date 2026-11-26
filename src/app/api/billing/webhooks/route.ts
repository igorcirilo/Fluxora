import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { DisabledBillingProvider } from "@/modules/billing/provider";

export const dynamic = "force-dynamic";

/**
 * Webhook de cobrança. Fluxo de produção: verificar assinatura server-to-server → deduplicar por
 * (provider, event_id) em app.webhook_events → enfileirar em app.jobs → responder 200.
 * Sem provedor configurado, todo evento é rejeitado (401) e nada é processado.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 256_000) return apiError("PAYLOAD_TOO_LARGE", "Corpo muito grande.", 413);
  const ok = await new DisabledBillingProvider().verifyWebhook(raw, req.headers.get("x-signature"));
  if (!ok) return apiError("WEBHOOK_UNVERIFIED", "Assinatura inválida ou provedor não configurado.", 401);
  return NextResponse.json({ received: true });
}
