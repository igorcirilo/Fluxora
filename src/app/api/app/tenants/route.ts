import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { handleError, readJson, zBizDate } from "@/lib/api";
import { assertSameOrigin, createTenant, requireUser, TENANT_COOKIE } from "@/lib/server/app-service";
import { todayBiz } from "@/modules/finance/dates";

export const dynamic = "force-dynamic";

const Body = z.object({ tradeName: z.string().trim().min(1).max(80), name: z.string().trim().max(150).optional(), openedOn: zBizDate, segment: z.enum(["comercio", "servicos", "misto"]) });

/** Onboarding: cria empresa + membership de titular + contas padrão (função SECURITY DEFINER). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const b = Body.parse(await readJson(req, 4_000));
    if (b.openedOn > todayBiz()) return NextResponse.json({ error: { code: "INVALID_DATE", message: "Data de abertura no futuro." } }, { status: 400 });
    const id = await createTenant(user.id, { name: b.name || b.tradeName, tradeName: b.tradeName, openedOn: b.openedOn, segment: b.segment });
    (await cookies()).set(TENANT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
