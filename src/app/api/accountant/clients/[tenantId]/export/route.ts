import { NextResponse } from "next/server";
import { apiError, handleError } from "@/lib/api";
import { accountantScopes, listTenants, loadState, requireUser } from "@/lib/server/app-service";

export const dynamic = "force-dynamic";

/** Exportação completa de UMA empresa cliente — exige vínculo de contador com escopo "export". */
export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await ctx.params;
    const user = await requireUser();
    const t = (await listTenants(user.id)).find((x) => x.id === tenantId && x.role === "accountant");
    if (!t) return apiError("TENANT_ACCESS_DENIED", "Acesso negado a esta empresa.", 403);
    if (!(await accountantScopes(user.id)).get(tenantId)?.includes("export")) return apiError("EXPORT_NOT_ALLOWED", "O titular não autorizou exportação para este vínculo.", 403);
    const state = await loadState(user.id, tenantId);
    return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: "contador", data: state }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="fluxora-${tenantId}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return handleError(e);
  }
}
