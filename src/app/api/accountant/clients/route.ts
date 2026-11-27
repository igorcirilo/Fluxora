import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { accountantScopes, listTenants, loadState, requireUser } from "@/lib/server/app-service";
import { clientSummary } from "@/modules/accounting/summary";
import { todayBiz } from "@/modules/finance/dates";

export const dynamic = "force-dynamic";

/** Empresas em que o usuário é contador, com resumo (somente leitura, sob RLS de cada empresa). */
export async function GET() {
  try {
    const user = await requireUser();
    const tenants = (await listTenants(user.id)).filter((t) => t.role === "accountant");
    const scopes = await accountantScopes(user.id);
    const today = todayBiz();
    const clients = [];
    for (const t of tenants) {
      const state = await loadState(user.id, t.id);
      clients.push({ ...clientSummary(state, today), scopes: scopes.get(t.id) ?? ["read"] });
    }
    return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
