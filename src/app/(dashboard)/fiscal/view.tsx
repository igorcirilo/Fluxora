"use client";
import Link from "next/link";
import { useState } from "react";
import { Ban, CheckCircle2, ChevronRight, FileText, PlugZap, Send, Trash2, XCircle } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { useAction } from "@/components/use-action";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, useToast, cn } from "@/components/ui";
import { FISCAL_DOC_LABEL, FISCAL_STATUS_LABEL, getFiscalProvider, type FiscalStatus } from "@/modules/fiscal/provider";
import { isDomainError } from "@/lib/errors";
import { formatBRL } from "@/modules/finance/money";
import { NfcePanel } from "@/components/nfce-panel";
import { nfceSaleIssues } from "@/modules/fiscal/nfce";
import { fiscalSettingsOf } from "@/modules/fiscal/settings-ops";

const DOCS = [
  {
    type: "NFS-e",
    who: "MEI prestador de serviços",
    reqs: ["Emissor nacional (gov.br/nfse) ou provedor homologado", "Obrigação conforme atividade e município", "Certificado/credenciais do provedor"],
  },
  { type: "NFC-e", who: "Venda ao consumidor (varejo)", reqs: ["Análise estadual (SEFAZ da UF)", "Inscrição estadual e credenciamento", "Certificado digital e CSC quando aplicáveis"] },
  { type: "NF-e", who: "Venda de mercadorias entre empresas", reqs: ["Inscrição estadual", "Certificado digital", "Homologação antes da produção"] },
];

const FLOW: FiscalStatus[] = ["draft", "queued", "submitted", "authorized"];

export function FiscalView() {
  const t = useTenant();
  const act = useAction();
  const toast = useToast();
  const [sending, setSending] = useState<string | null>(null);
  if (!t) return null;
  const provider = getFiscalProvider();
  const docs = t.state.fiscalDocuments.slice().reverse();

  const send = async (id: string) => {
    setSending(id);
    try {
      await provider.issue({ tenantId: t.state.tenant.id, idempotencyKey: id, type: "nfse", saleId: id });
    } catch (e) {
      toast("error", isDomainError(e) ? e.message : "Falha no envio.");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="animate-in">
      <PageHeader title="Fiscal" description="NFS-e, NFC-e e NF-e em etapas independentes, somente via provedor homologado." />
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
          <PlugZap size={20} />
        </span>
        <div className="text-[13.5px]">
          <div className="font-semibold">Emissão fiscal desativada nesta demonstração</div>
          <p className="mt-0.5 text-muted">
            Nenhum provedor fiscal está configurado ({provider.id}). O Fluxora nunca marca uma nota como autorizada sem protocolo do autorizador, e o comprovante de venda <b>não</b> é nota fiscal. A
            obrigatoriedade por atividade e UF deve ser confirmada com o contador e a SEFAZ.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <NfcePanel state={t.state} providerConfigured={provider.configured} />
      </div>

      <h2 className="mt-6 mb-3 text-[15px] font-semibold">Documentos fiscais suportados</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {DOCS.map((d) => (
          <Card key={d.type}>
            <CardHeader title={d.type} subtitle={d.who} action={<Badge tone="neutral">Não configurado</Badge>} />
            <CardBody className="pt-3">
              <ul className="space-y-1.5 text-[12.5px] text-muted">
                {d.reqs.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
                    {r}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader title="Ciclo de um documento fiscal" subtitle="Estados explícitos; timeout ⇒ consulta antes de qualquer reenvio" />
        <CardBody>
          <div className="flex flex-wrap items-center gap-1.5">
            {FLOW.map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                <Badge tone={s === "authorized" ? "success" : "brand"}>{FISCAL_STATUS_LABEL[s]}</Badge>
                {i < FLOW.length - 1 ? <ChevronRight size={14} className="text-subtle" /> : null}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[12.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <XCircle size={14} className="text-danger" /> Rejeitado → volta a rascunho para correção
            </span>
            <span className="flex items-center gap-1.5">
              <Ban size={14} /> Cancelado (somente após autorizado, com protocolo)
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-accent" /> Autorizado exige número de protocolo
            </span>
          </div>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Documentos" subtitle="Rascunhos criados a partir de vendas" />
        {docs.length === 0 ? (
          <EmptyState
            icon={<FileText size={24} />}
            title="Nenhum documento"
            description="Abra uma venda e toque em “Rascunho fiscal” para preparar um documento."
            action={
              <Link href="/vendas">
                <Button variant="outline">Ir para vendas</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => {
              const sale = t.state.sales.find((s) => s.id === d.saleId);
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-[11px] font-semibold">{FISCAL_DOC_LABEL[d.type]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">
                      Venda #{sale?.number ?? "—"} · {sale ? formatBRL(sale.totalCents) : ""}
                    </div>
                    <div className="text-[12px] text-muted">{new Date(d.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                    {sale && d.status === "draft" && d.type === "nfce" && nfceSaleIssues(sale, t.state.products, fiscalSettingsOf(t.state)).length ? (
                      <div className="mt-1 text-[12px] text-warn">Pendências: {nfceSaleIssues(sale, t.state.products, fiscalSettingsOf(t.state)).slice(0, 3).join(" ")}</div>
                    ) : null}
                  </div>
                  <Badge tone={d.status === "cancelled" ? "neutral" : "brand"}>{FISCAL_STATUS_LABEL[d.status]}</Badge>
                  {d.status === "draft" ? (
                    <div className={cn("flex gap-1")}>
                      <Button size="sm" variant="outline" loading={sending === d.id} onClick={() => send(d.id)} title="Requer provedor homologado">
                        <Send size={14} /> Enviar
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Descartar rascunho" onClick={() => void act("fiscal.discard", { id: d.id }, "Rascunho descartado.")}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
