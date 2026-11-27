"use client";
import { useState } from "react";
import { CheckCircle2, CircleDashed, Lock, ShieldCheck, Store, UserCheck } from "lucide-react";
import { useAction } from "@/components/use-action";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Segmented, Select, Switch, Textarea, cn } from "@/components/ui";
import { formatIeSP, isValidIeSP, nfceReadiness, type FiscalSettings } from "@/modules/fiscal/nfce";
import { fiscalSettingsOf } from "@/modules/fiscal/settings-ops";
import type { TenantState } from "@/modules/tenants/state";

const OWNER_LABEL = { empresa: "Empresa", contador: "Contador", fluxora: "Fluxora" } as const;

/** Painel de preparação da NFC-e (piloto SP): checklist, configuração e revisão do contador. */
export function NfcePanel({ state, providerConfigured }: { state: TenantState; providerConfigured: boolean }) {
  const settings = fiscalSettingsOf(state);
  const { items, ready, productsMissing } = nfceReadiness(settings, state.products, providerConfigured);
  const done = items.filter((i) => i.status === "ok").length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="NFC-e · São Paulo (piloto)"
          subtitle={`${done} de ${items.length} etapas concluídas`}
          action={<Badge tone={ready ? "success" : "warn"}>{ready ? "Pronto para homologação" : "Em preparação"}</Badge>}
        />
        <CardBody className="pt-3">
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length}>
            <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                <span className={cn("mt-0.5", i.status === "ok" ? "text-accent" : i.status === "bloqueado" ? "text-subtle" : "text-warn")}>
                  {i.status === "ok" ? <CheckCircle2 size={18} /> : i.status === "bloqueado" ? <Lock size={18} /> : <CircleDashed size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium">{i.label}</span>
                  <span className="block text-[12.5px] text-muted">{i.detail}</span>
                </span>
                <Badge tone={i.owner === "contador" ? "info" : i.owner === "fluxora" ? "brand" : "neutral"}>{OWNER_LABEL[i.owner]}</Badge>
              </li>
            ))}
          </ul>
          {productsMissing.length ? (
            <p className="mt-3 text-[12.5px] text-muted">
              Sem dados fiscais: {productsMissing.slice(0, 5).map((p) => p.name).join(", ")}
              {productsMissing.length > 5 ? "…" : ""}. Edite em Produtos → Dados fiscais.
            </p>
          ) : null}
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SettingsForm key={JSON.stringify(settings)} settings={settings} />
        <ReviewCard key={settings.accountantReview?.at ?? "none"} settings={settings} />
      </div>
    </div>
  );
}

function SettingsForm({ settings }: { settings: FiscalSettings }) {
  const act = useAction();
  const [f, setF] = useState({
    ie: settings.ie ? formatIeSP(settings.ie) : "",
    environment: settings.environment,
    series: String(settings.series),
    nextNumber: String(settings.nextNumber),
    crt: settings.crt ?? "",
    accreditationConfirmed: !!settings.accreditationConfirmedAt,
    certificateConfigured: settings.certificateConfigured,
    cscConfigured: settings.cscConfigured,
  });
  const [busy, setBusy] = useState(false);
  const ieOk = !f.ie.trim() || isValidIeSP(f.ie);
  const save = async () => {
    setBusy(true);
    await act(
      "fiscal.settings",
      {
        ie: f.ie.trim() || undefined,
        environment: f.environment,
        series: Number(f.series),
        nextNumber: Number(f.nextNumber),
        crt: (f.crt || undefined) as "1" | "2" | "3" | "4" | undefined,
        accreditationConfirmed: f.accreditationConfirmed,
        certificateConfigured: f.certificateConfigured,
        cscConfigured: f.cscConfigured,
      },
      "Configuração fiscal salva.",
    );
    setBusy(false);
  };
  return (
    <Card>
      <CardHeader title="Configuração da empresa" subtitle="Dados para a NFC-e. Certificado e CSC ficam no provedor, nunca aqui." action={<Store size={18} className="text-subtle" />} />
      <CardBody className="space-y-4">
        <Field label="Inscrição estadual (SP)" error={ieOk ? null : "IE inválida: confira os 12 dígitos."}>
          {(id) => <Input id={id} inputMode="numeric" maxLength={15} value={f.ie} onChange={(e) => setF({ ...f, ie: e.target.value })} placeholder="000.000.000.000" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Série">{(id) => <Input id={id} type="number" min={1} max={999} value={f.series} onChange={(e) => setF({ ...f, series: e.target.value })} />}</Field>
          <Field label="Próximo número">{(id) => <Input id={id} type="number" min={1} value={f.nextNumber} onChange={(e) => setF({ ...f, nextNumber: e.target.value })} />}</Field>
        </div>
        <Field label="Regime tributário (CRT)" hint="Confirmar com o contador.">
          {(id) => (
            <Select id={id} value={f.crt} onChange={(e) => setF({ ...f, crt: e.target.value })}>
              <option value="">A definir</option>
              <option value="4">4 – Simples Nacional · MEI</option>
              <option value="1">1 – Simples Nacional</option>
            </Select>
          )}
        </Field>
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium">Ambiente</span>
          <Segmented value={f.environment} onChange={(v) => setF({ ...f, environment: v })} options={[{ value: "homologacao", label: "Homologação (testes)" }, { value: "producao", label: "Produção" }]} />
          {f.environment === "producao" && !settings.accountantReview ? <p className="text-[12px] text-danger">Produção só depois da revisão do contador.</p> : null}
        </div>
        <div className="space-y-3 rounded-2xl border border-line p-3">
          <Switch checked={f.accreditationConfirmed} onChange={(v) => setF({ ...f, accreditationConfirmed: v })} label="Credenciamento NFC-e aprovado na SEFAZ-SP" />
          <Switch checked={f.certificateConfigured} onChange={(v) => setF({ ...f, certificateConfigured: v })} label="Certificado A1 instalado no provedor" />
          <Switch checked={f.cscConfigured} onChange={(v) => setF({ ...f, cscConfigured: v })} label="CSC configurado no provedor" />
        </div>
        <Button className="w-full" loading={busy} disabled={!ieOk} onClick={() => void save()}>
          Salvar configuração
        </Button>
      </CardBody>
    </Card>
  );
}

function ReviewCard({ settings }: { settings: FiscalSettings }) {
  const act = useAction();
  const [name, setName] = useState(settings.accountantReview?.name ?? "");
  const [note, setNote] = useState(settings.accountantReview?.note ?? "");
  const r = settings.accountantReview;
  return (
    <Card>
      <CardHeader title="Revisão do contador" subtitle="Obrigatória antes de qualquer emissão em produção" action={<UserCheck size={18} className={r ? "text-accent" : "text-subtle"} />} />
      <CardBody className="space-y-3">
        {r ? (
          <>
            <div className="flex items-start gap-2 rounded-xl bg-accent-soft p-3 text-[13px] text-accent">
              <ShieldCheck size={17} className="mt-px shrink-0" />
              <span>
                Revisado por <b>{r.name}</b> em {new Date(r.at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.{r.note ? ` ${r.note}` : ""}
              </span>
            </div>
            <Button variant="outline" className="w-full" onClick={() => void act("fiscal.review", { name: r.name, confirmed: false }, "Revisão revogada. Ambiente voltou para homologação.")}>
              Revogar revisão
            </Button>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">O contador confere a obrigatoriedade, o CRT e os códigos fiscais dos produtos. O registro fica na auditoria.</p>
            <Field label="Nome do contador responsável">{(id) => <Input id={id} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Mônica" />}</Field>
            <Field label="Observações (opcional)">{(id) => <Textarea id={id} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button className="w-full" disabled={name.trim().length < 2} onClick={() => void act("fiscal.review", { name, note: note || undefined, confirmed: true }, "Revisão do contador registrada.")}>
              Registrar revisão
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
