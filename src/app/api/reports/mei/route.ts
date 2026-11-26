import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, readJson, zBizDate, zCents } from "@/lib/api";
import { limitReport, projectLimit } from "@/modules/mei/limit";
import { resolveRule } from "@/modules/mei/rules";
import { todayBiz } from "@/modules/finance/dates";

export const dynamic = "force-dynamic";

const Body = z.object({
  openedOn: zBizDate,
  year: z.number().int().min(2018).max(2100),
  regime: z.enum(["mei-geral", "mei-caminhoneiro"]).default("mei-geral"),
  asOf: zBizDate.optional(),
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        kind: z.enum(["sale", "service", "historical_import", "reversal"]),
        competenceDate: zBizDate,
        amountCents: zCents.positive(),
        description: z.string().max(200).default(""),
        reversalOf: z.string().max(64).optional(),
      }),
    )
    .max(50_000),
});

/**
 * POST /api/reports/mei — cálculo stateless do limite MEI (sem persistência, sem dados pessoais).
 * Na versão com banco, os lançamentos vêm do tenant autenticado (RLS), não do corpo.
 */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await readJson(req));
    const report = limitReport({ entries: body.entries, openedOn: body.openedOn, year: body.year, regime: body.regime });
    const rule = resolveRule(body.regime, body.year);
    const projection = projectLimit(report, body.asOf ?? todayBiz(), body.openedOn, rule);
    return NextResponse.json({ report, projection, rule: { id: rule.id, reviewedAt: rule.reviewedAt, requiresAccountantReview: rule.requiresAccountantReview } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
