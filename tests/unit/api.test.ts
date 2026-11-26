import { describe, expect, it } from "vitest";
import { POST as meiPost } from "@/app/api/reports/mei/route";
import { POST as cashPost } from "@/app/api/reports/cash/route";
import { GET as fiscalGet, POST as fiscalPost } from "@/app/api/fiscal/documents/route";
import { POST as webhookPost } from "@/app/api/billing/webhooks/route";
import { GET as health } from "@/app/api/health/route";

const json = (body: unknown) => new Request("http://x/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("API — contratos e erros estáveis", () => {
  it("health", async () => {
    const r = health();
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("ok");
  });

  it("relatório MEI calcula limite e projeção", async () => {
    const r = await meiPost(json({ openedOn: "2026-10-01", year: 2026, asOf: "2026-11-26", entries: [{ id: "a", kind: "sale", competenceDate: "2026-10-01", amountCents: 2_025_000 }] }));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.report.status).toBe("limite_atingido");
    expect(b.rule.requiresAccountantReview).toBe(true);
  });

  it("validação Zod retorna 400 VALIDATION_ERROR com caminho", async () => {
    const r = await meiPost(json({ openedOn: "01/10/2026", year: 2026, entries: [] }));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error.code).toBe("VALIDATION_ERROR");
    expect(b.error.details[0].path).toBe("openedOn");
  });

  it("JSON malformado e regime não suportado têm erros estáveis", async () => {
    expect((await (await meiPost(json("{oops"))).json()).error.code).toBe("VALIDATION_ERROR");
    const r = await meiPost(json({ openedOn: "2026-01-01", year: 2026, regime: "mei-caminhoneiro", entries: [] }));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("REGIME_NOT_SUPPORTED");
  });

  it("estorno inválido vira erro de domínio, não 500", async () => {
    const r = await meiPost(json({ openedOn: "2026-01-01", year: 2026, entries: [{ id: "x", kind: "reversal", competenceDate: "2026-01-02", amountCents: 1, reversalOf: "nada" }] }));
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("REVERSAL_ORIGINAL_NOT_FOUND");
  });

  it("relatório de caixa", async () => {
    const r = await cashPost(json({ start: "2026-02-01", end: "2026-03-01", movements: [{ id: "a", accountId: "b", date: "2026-01-01", direction: "in", amountCents: 1000, category: "other_income" }, { id: "c", accountId: "b", date: "2026-02-01", direction: "out", amountCents: 300, category: "expense" }] }));
    expect((await r.json()).balanceCents).toBe(700);
    expect((await cashPost(json({ start: "2026-03-01", end: "2026-02-01", movements: [] }))).status).toBe(400);
  });

  it("fiscal sem provedor responde 503 e nunca sucesso", async () => {
    expect((await fiscalGet().json()).configured).toBe(false);
    const r = await fiscalPost(json({ type: "nfse", idempotencyKey: "abcdefgh" }));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("FISCAL_PROVIDER_NOT_CONFIGURED");
  });

  it("webhook sem assinatura válida é rejeitado", async () => {
    const r = await webhookPost(json({ id: "evt_1", type: "payment.confirmed" }));
    expect(r.status).toBe(401);
  });
});
