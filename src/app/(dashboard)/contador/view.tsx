"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Briefcase, Download, Eye, FileCheck2, KeyRound, Mail } from "lucide-react";
import { useTenant, getStore, getAccountStore } from "@/demo/use-demo";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Progress, Segmented, useToast, cn } from "@/components/ui";
import { downloadCsv, downloadText } from "@/components/csv";
import { clientSummary, summariesCsv, type ClientSummary } from "@/modules/accounting/summary";
import { LIMIT_STATUS_LABEL } from "@/modules/mei/limit";
import { formatBRL } from "@/modules/finance/money";
import { formatBizDate, todayBiz } from "@/modules/finance/dates";
import { LIMIT_TONE } from "@/demo/selectors";

type Client = ClientSummary & { scopes: string[] };
type Invite = { tenantId: string; linkId: string; companyLabel: string; scopes: string[]; grantedAt: string; expiresAt: string };

export function AccountantView() {
  const t = useTenant();
  const router = useRouter();
  const toast = useToast();
  const [remote, setRemote] = useState<Client[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [filter, setFilter] = useState<"todas" | "atencao">("todas");
  const [version, setVersion] = useState(0);
  const mode = t?.mode;
  const state = t?.state;

  // Demo: resumo calculado no navegador a partir das empresas em que a contadora fictícia tem vínculo.
  const demoClients = useMemo<Client[] | null>(() => {
    if (mode !== "demo" || !state) return null;
    const store = getStore()!;
    const db = store.load();
    const today = todayBiz();
    return store.accountantClients().map((s) => ({ ...clientSummary(s, today), scopes: s.accountantLinks.find((l) => l.accountantUserId === db.session?.userId && !l.revokedAt)?.scopes ?? ["read"] }));
  }, [mode, state]);

  // Conta real: dados do servidor (RLS por empresa).
  useEffect(() => {
    if (mode !== "conta") return;
    let alive = true;
    const acc = getAccountStore()!;
    Promise.all([acc.clients<Client>(), acc.invites()])
      .then(([c, i]) => {
        if (!alive) return;
        setRemote(c);
        setInvites(i);
      })
      .catch(() => {
        if (!alive) return;
        setRemote([]);
        toast("error", "Não foi possível carregar as empresas clientes.");
      });
    return () => {
      alive = false;
    };
  }, [mode, toast, version]);

  const clients = mode === "demo" ? demoClients : remote;
  const load = () => setVersion((v) => v + 1);
  const list = useMemo(() => (clients ?? []).filter((c) => filter === "todas" || c.attention > 0).sort((a, b) => b.attention - a.attention || a.tradeName.localeCompare(b.tradeName, "pt-BR")), [clients, filter]);
  if (!t) return null;

  const open = async (tenantId: string) => {
    if (t.mode === "demo") {
      const s = getStore()!;
      const userId = s.load().session!.userId;
      s.login(userId, tenantId);
    } else await getAccountStore()!.selectTenant(tenantId);
    router.push("/painel");
  };

  const exportClient = (c: Client) => {
    if (!c.scopes.includes("export")) return toast("error", "O titular não autorizou exportação para este vínculo.");
    if (t.mode === "demo") {
      const s = getStore()!.load().tenants[c.tenantId];
      if (s) downloadText(`fluxora-${c.tradeName.replace(/\W+/g, "-").toLowerCase()}-${todayBiz()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), notice: "Dados fictícios — demonstração", data: s }, null, 2));
    } else {
      const a = document.createElement("a");
      a.href = `/api/accountant/clients/${c.tenantId}/export`;
      a.download = `fluxora-${c.tenantId}.json`;
      a.click();
    }
  };

  const attention = (clients ?? []).filter((c) => c.attention > 0).length;

  return (
    <div className="animate-in">
      <PageHeader
        title="Painel do contador"
        description="Empresas que autorizaram seu acesso. Somente leitura; o titular pode revogar a qualquer momento."
        actions={
          <Button variant="outline" disabled={!clients?.length} onClick={() => downloadCsv(`fluxora-clientes-${todayBiz()}.csv`, summariesCsv(clients ?? []))}>
            <Download size={16} /> Resumo (CSV)
          </Button>
        }
      />

      {t.mode === "conta" ? <Invites invites={invites} onAccepted={load} /> : null}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Empresas" value={String(clients?.length ?? "–")} />
        <Stat label="Pedem atenção" value={String(attention)} tone={attention ? "warn" : undefined} />
        <Stat label="Faturamento somado (ano)" value={formatBRL((clients ?? []).reduce((s, c) => s + c.grossCents, 0))} />
      </div>
      <Segmented
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "todas", label: "Todas" },
          { value: "atencao", label: `Pedem atenção (${attention})` },
        ]}
      />

      {clients === null ? (
        <p className="text-[13.5px] text-muted">Carregando empresas…</p>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Briefcase size={24} />} title={clients.length ? "Nenhuma empresa neste filtro" : "Nenhuma empresa vinculada"} description="Quando um titular convidar você e o convite for aceito com o código, a empresa aparece aqui." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((c) => (
            <ClientCard key={c.tenantId} c={c} active={c.tenantId === t.state.tenant.id} onOpen={() => void open(c.tenantId)} onExport={() => exportClient(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-[11.5px] leading-tight text-muted sm:text-[12.5px]">{label}</div>
      <div className={cn("mt-1 truncate text-[16px] font-semibold tabular sm:text-[19px]", tone === "warn" && "text-warn")}>{value}</div>
    </Card>
  );
}

function ClientCard({ c, active, onOpen, onExport }: { c: Client; active: boolean; onOpen: () => void; onExport: () => void }) {
  const tone = LIMIT_TONE[c.limitStatus];
  const issues: string[] = [];
  if (c.dasOverdue.length) issues.push(`DAS sem pagamento registrado: ${c.dasOverdue.join(", ")}`);
  if (c.payablesOverdueCents) issues.push(`Contas a pagar vencidas: ${formatBRL(c.payablesOverdueCents)}`);
  if (c.receivablesOverdueCents) issues.push(`Recebíveis vencidos: ${formatBRL(c.receivablesOverdueCents)}`);
  if (c.usedBp >= 8000) issues.push(`Limite MEI em ${(c.usedBp / 100).toFixed(1).replace(".", ",")}%`);
  return (
    <Card>
      <CardHeader
        title={c.tradeName}
        subtitle={`${c.name} · aberta em ${formatBizDate(c.openedOn)}`}
        action={c.attention ? <Badge tone="warn">{c.attention} ponto(s) de atenção</Badge> : <Badge tone="success">Em dia</Badge>}
      />
      <CardBody className="space-y-4 pt-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span className="text-muted">Limite MEI {c.year}</span>
            <span className="font-medium tabular">
              {formatBRL(c.grossCents)} de {formatBRL(c.limitCents)}
            </span>
          </div>
          <Progress valueBp={c.usedBp} tone={tone === "brand" ? "brand" : tone} />
          <div className="mt-1 text-[12px] text-muted">{LIMIT_STATUS_LABEL[c.limitStatus]}</div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
          <Fact k="DAS a pagar" v={c.dasPending.length ? c.dasPending.join(", ") : "—"} />
          <Fact k="Vendas no mês" v={String(c.salesThisMonth)} />
          <Fact k="Última venda" v={c.lastSaleDate ? formatBizDate(c.lastSaleDate) : "—"} />
          <Fact k="NFC-e (preparação)" v={`${c.nfceDone}/${c.nfceTotal} etapas`} />
        </dl>
        {issues.length ? (
          <ul className="space-y-1 rounded-xl bg-warn-soft p-3 text-[12.5px] text-warn">
            {issues.map((i) => (
              <li key={i} className="flex gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {i}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={active ? "secondary" : "primary"} onClick={onOpen}>
            <Eye size={14} /> {active ? "Empresa aberta" : "Abrir (somente leitura)"}
          </Button>
          <Button size="sm" variant="outline" disabled={!c.scopes.includes("export")} onClick={onExport} title={c.scopes.includes("export") ? "Exportar todos os dados" : "Exportação não autorizada"}>
            <FileCheck2 size={14} /> Exportar dados
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <dt className="text-muted">{k}</dt>
      <dd className="truncate font-medium tabular">{v}</dd>
    </div>
  );
}

function Invites({ invites, onAccepted }: { invites: Invite[]; onAccepted: () => void }) {
  const toast = useToast();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!invites.length) return null;
  return (
    <Card className="mb-4 border-brand/30">
      <CardHeader title="Convites recebidos" subtitle="Digite o código que o titular enviou para você" action={<Mail size={18} className="text-brand" />} />
      <CardBody className="space-y-3 pt-3">
        {invites.map((i) => (
          <div key={i.linkId} className="rounded-xl border border-line p-3">
            <div className="text-[14px] font-medium">{i.companyLabel || "Empresa"}</div>
            <div className="text-[12px] text-muted">
              Acesso: {i.scopes.map((s) => (s === "read" ? "leitura" : "exportação")).join(" + ")} · válido até {new Date(i.expiresAt).toLocaleDateString("pt-BR")}
            </div>
            <div className="mt-2 flex gap-2">
              <Input aria-label={`Código do convite de ${i.companyLabel}`} placeholder="Código (8 caracteres)" maxLength={8} value={codes[i.linkId] ?? ""} onChange={(e) => setCodes({ ...codes, [i.linkId]: e.target.value.toUpperCase() })} className="font-mono uppercase" />
              <Button
                loading={busy === i.linkId}
                disabled={(codes[i.linkId] ?? "").trim().length !== 8}
                onClick={async () => {
                  setBusy(i.linkId);
                  const r = await getAccountStore()!.acceptInvite(i.tenantId, i.linkId, codes[i.linkId]!);
                  setBusy(null);
                  if (r.ok) {
                    toast("success", "Convite aceito. A empresa já aparece no seu painel.");
                    onAccepted();
                  } else toast("error", r.message);
                }}
              >
                <KeyRound size={15} /> Aceitar
              </Button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
