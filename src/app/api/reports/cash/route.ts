import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, readJson, zBizDate, zCents } from "@/lib/api";
import { cashReport } from "@/modules/finance/cash";

export const dynamic = "force-dynamic";

const Body = z.object({
  start: zBizDate,
  end: zBizDate,
  accountId: z.string().max(64).optional(),
  movements: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        accountId: z.string().min(1).max(64),
        date: zBizDate,
        direction: z.enum(["in", "out"]),
        amountCents: zCents.positive(),
        category: z.enum(["opening_balance", "sale_receipt", "receivable_settlement", "other_income", "expense", "payable_settlement", "fee", "owner_withdrawal", "capital_contribution", "loan", "transfer", "refund", "reversal"]),
        description: z.string().max(200).default(""),
        transferId: z.string().max(64).optional(),
      }),
    )
    .max(100_000),
});

/** POST /api/reports/cash — saldo inicial + recebimentos − pagamentos para [start, end). */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await readJson(req));
    if (b.end <= b.start) return handleError(new z.ZodError([{ code: "custom", path: ["end"], message: "end deve ser após start", input: b.end }]));
    return NextResponse.json(cashReport(b.movements, b.start, b.end, b.accountId), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return handleError(e);
  }
}
