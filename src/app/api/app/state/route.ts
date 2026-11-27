import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { activeTenantId, loadState, requireUser } from "@/lib/server/app-service";

export const dynamic = "force-dynamic";

/** Estado completo da empresa ativa (somente leitura, sob RLS). */
export async function GET() {
  try {
    const user = await requireUser();
    const tenantId = await activeTenantId(user.id);
    if (!tenantId) return NextResponse.json({ state: null }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ state: await loadState(user.id, tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
