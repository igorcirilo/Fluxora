import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, readJson } from "@/lib/api";
import { activeTenantId, assertSameOrigin, executeCommand, requireUser } from "@/lib/server/app-service";

export const dynamic = "force-dynamic";

const Body = z.object({ name: z.string().min(3).max(40), input: z.unknown() });

/** Executa um comando de domínio na empresa ativa. Resposta: { value, state }. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const tenantId = await activeTenantId(user.id);
    if (!tenantId) return NextResponse.json({ error: { code: "NO_TENANT", message: "Crie ou selecione uma empresa." } }, { status: 409 });
    const { name, input } = Body.parse(await readJson(req, 256_000));
    const out = await executeCommand(user.id, tenantId, name, input);
    return NextResponse.json({ value: out.value ?? null, state: out.state }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
