import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Healthcheck para Docker/Coolify e Vercel. Não expõe dados nem segredos. */
export function GET() {
  return NextResponse.json(
    { status: "ok", app: "fluxora", mode: process.env.NEXT_PUBLIC_DEMO_MODE === "0" ? "app" : "demo", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
