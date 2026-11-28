import { NextResponse } from "next/server";
import { z } from "zod";
import { isDomainError, type DomainErrorCode } from "./errors";

const STATUS: Partial<Record<DomainErrorCode, number>> = {
  TENANT_ACCESS_DENIED: 403,
  DOCUMENT_ALREADY_IMPORTED: 409,
  FISCAL_PROVIDER_NOT_CONFIGURED: 503,
  BILLING_PROVIDER_NOT_CONFIGURED: 503,
  RULE_NOT_FOUND: 422,
  REGIME_NOT_SUPPORTED: 422,
};

/** Resposta de erro estável: { error: { code, message } } — sem dados pessoais nem stack. */
export function apiError(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(e: unknown) {
  if (e instanceof z.ZodError) return apiError("VALIDATION_ERROR", "Dados inválidos.", 400, e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  if (isDomainError(e)) return apiError(e.code, e.message, STATUS[e.code] ?? 422);
  return apiError("INTERNAL", "Erro interno.", 500);
}

export async function readJson(req: Request, maxBytes = 512_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new z.ZodError([{ code: "custom", path: [], message: "Corpo muito grande.", input: undefined }]);
  const text = await req.text();
  if (text.length > maxBytes) throw new z.ZodError([{ code: "custom", path: [], message: "Corpo muito grande.", input: undefined }]);
  try {
    return JSON.parse(text);
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "JSON inválido.", input: undefined }]);
  }
}

export const zBizDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data ISO YYYY-MM-DD");
export const zCents = z.number().int().nonnegative().max(100_000_000_000);
