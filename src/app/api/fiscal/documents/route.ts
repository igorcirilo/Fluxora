import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, readJson } from "@/lib/api";
import { getFiscalProvider } from "@/modules/fiscal/provider";

export const dynamic = "force-dynamic";

const Body = z.object({ type: z.enum(["nfse", "nfce", "nfe"]), saleId: z.string().max(64).optional(), idempotencyKey: z.string().min(8).max(100) });

/** GET: situação da integração fiscal. Nunca expõe credenciais. */
export function GET() {
  const p = getFiscalProvider();
  return NextResponse.json({ provider: p.id, configured: p.configured, documents: [] }, { headers: { "Cache-Control": "no-store" } });
}

/** POST: emissão. Sem provedor homologado responde 503 FISCAL_PROVIDER_NOT_CONFIGURED — jamais sucesso simulado. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await readJson(req, 16_000));
    const result = await getFiscalProvider().issue({ tenantId: "unauthenticated", idempotencyKey: body.idempotencyKey, type: body.type, saleId: body.saleId });
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    return handleError(e);
  }
}
