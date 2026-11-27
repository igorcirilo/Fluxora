import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { handleError, readJson } from "@/lib/api";
import { DomainError } from "@/lib/errors";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { activeTenantId, assertSameOrigin, listTenants, requireUser, TENANT_COOKIE } from "@/lib/server/app-service";

export const dynamic = "force-dynamic";

/** GET: usuário, empresas (memberships) e empresa ativa. */
export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ enabled: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    const user = await requireUser();
    const tenants = await listTenants(user.id);
    return NextResponse.json({ enabled: true, user, tenants, activeTenantId: await activeTenantId(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ enabled: true, user: null }, { headers: { "Cache-Control": "no-store" } });
  }
}

/** POST: troca a empresa ativa (somente se houver membership). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser();
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(await readJson(req, 4_000));
    const tenants = await listTenants(user.id);
    if (!tenants.some((t) => t.id === tenantId)) throw new DomainError("TENANT_ACCESS_DENIED", "Acesso negado a esta empresa.");
    (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
