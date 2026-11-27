import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, handleError, readJson } from "@/lib/api";
import { acceptInvite, assertSameOrigin, pendingInvites, requireUser } from "@/lib/server/app-service";

export const dynamic = "force-dynamic";

/** Convites pendentes endereçados ao e-mail do usuário (sem expor o código). */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ invites: await pendingInvites(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}

const Body = z.object({ tenantId: z.string().uuid(), linkId: z.string().min(1).max(64), code: z.string().trim().min(8).max(8) });

const MESSAGES: Record<string, [number, string]> = {
  invalid_code: [400, "Código incorreto. Confira com quem enviou o convite."],
  locked: [423, "Convite bloqueado após 5 tentativas. Peça um novo convite."],
  expired: [410, "Convite expirado. Peça um novo convite."],
  not_found: [404, "Convite não encontrado ou já utilizado."],
  unauthenticated: [401, "Entre novamente."],
};

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const b = Body.parse(await readJson(req, 2_000));
    const r = await acceptInvite(user.id, b.tenantId, b.linkId, b.code);
    if (r === "ok") return NextResponse.json({ ok: true });
    const [status, message] = MESSAGES[r] ?? [400, "Não foi possível aceitar o convite."];
    return apiError(`INVITE_${r.toUpperCase()}`, message, status);
  } catch (e) {
    return handleError(e);
  }
}
