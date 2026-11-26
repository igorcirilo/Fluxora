"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck2, ExternalLink, FileClock, History, Scale, ShieldCheck, Upload } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { safeParse, useAction } from "@/components/use-action";
import { Badge, BarChart, Button, Card, CardBody, CardHeader, Field, Gauge, InfoTip, Input, Modal, MoneyInput, PageHeader, Segmented, cn } from "@/components/ui";
import { LIMIT_COLOR, LIMIT_TONE, meiSummary } from "@/demo/selectors";
import { formatBRL, parseCents } from "@/modules/finance/money";
import { formatBizDate, monthLabel, parts, todayBiz } from "@/modules/finance/dates";
import { LIMIT_STATUS_LABEL, grossRevenue, type LimitStatus } from "@/modules/mei/limit";
import { CALENDAR_VERSION, type DasObligation } from "@/modules/mei/calendar";
import { registerDasPayment } from "@/modules/mei/ops";
import { importHistoricalRevenue } from "@/modules/finance/ops";

const STATUS_TEXT: Record<LimitStatus, string> = {
  sem_atividade: "A empresa não tinha atividade neste ano.",
  normal: "Faturamento dentro do limite. Continue registrando todas as vendas.",
  monitorar: "Você passou de 80% do limite. Acompanhe mês a mês e converse com seu contador.",
  atencao: "Você passou de 90% do limite. Planeje com o contador antes de novas vendas grandes.",
  limite_atingido: "O limite foi atingido exatamente. Qualquer venda adicional gera excesso.",
  excesso_ate_20: "Excesso de até 20%: em regra, o desenquadramento produz efeitos no ano seguinte. Confirme com seu contador — o Fluxora não faz desenquadramento automático.",
  excesso_acima_20: "Excesso acima de 20%: em regra, os efeitos podem ser retroativos. Procure seu contador imediatamente — o Fluxora não faz desenquadramento automático.",
};

export function MeiView() {
  const t = useTenant();
  const act = useAction();
  const today = todayBiz();
  const currentYear = parts(today).year;
  const openedYear = t ? parts(t.state.tenant.openedOn).year : currentYear;
  const [year, setYear] = useState(currentYear);
  const [paying, setPaying] = useState<DasObligation | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const data = useMemo(() => (t ? meiSummary(t.state, today, year) : null), [t, today, year]);
  const dasnBase = useMemo(() => {
    if (!t) return null;
    const y = currentYear - 1;
    if (y < openedYear) return null;
    const rev = t.state.revenues;
    const byId = new Map(rev.map((r) => [r.id, r]));
    let commerce = 0;
    let services = 0;
    for (const r of rev) {
      const ref = r.kind === "reversal" ? byId.get(r.reversalOf ?? "") : r;
      if (!ref || parts(ref.competenceDate).year !== y) continue;
      const v = r.kind === "reversal" ? -r.amountCents : r.amountCents;
      if (ref.kind === "service") services += v;
      else commerce += v;
    }
    return { y, commerce, services, total: grossRevenue(rev, t.state.tenant.openedOn, y).gross };
  }, [t, currentYear, openedYear]);
  if (!t || !data) return null;
  const { report, projection, monthly, das, rule } = data;
  const years = Array.from({ length: Math.min(3, currentYear - openedYear + 1) }, (_, i) => currentYear - i);
  const monthlyPace = Math.floor(report.limitCents / Math.max(1, report.activeMonths));
  const pending = das.filter((d) => d.status === "pendente" || d.status === "vencido");

  return (
    <div className="animate-in">
      <PageHeader
        title="Meu MEI"
        description="Limite de faturamento, DAS e declaração anual em linguagem simples."
        actions={
          <>
            {years.length > 1 ? <Segmented value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} /> : null}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Importar histórico
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title={`Limite ${year}`}
            subtitle={`${report.activeMonths} ${report.activeMonths === 1 ? "mês" : "meses"} de atividade · regra ${rule.id}`}
            action={
              <InfoTip
                text={
                  <>
                    Referência: {formatBRL(rule.annualLimitCents)} por ano, proporcional a {formatBRL(rule.annualLimitCents / 12)} por mês no ano de abertura (incluindo o mês de abertura). Soma a
                    receita bruta por competência, sem descontar despesas; aportes, empréstimos e transferências não contam. Parâmetros revisados em {formatBizDate(rule.reviewedAt)} — confirme com seu
                    contador.
                  </>
                }
              />
            }
          />
          <CardBody className="pt-2">
            <Gauge valueBp={report.usedBp} color={LIMIT_COLOR[report.status]}>
              <div className="text-[30px] font-semibold tracking-tight tabular">{(report.usedBp / 100).toFixed(1).replace(".", ",")}%</div>
              <Badge tone={LIMIT_TONE[report.status] === "brand" ? "brand" : LIMIT_TONE[report.status]}>{LIMIT_STATUS_LABEL[report.status]}</Badge>
            </Gauge>
            <dl className="mt-5 space-y-2 text-[13.5px]">
              <Row k="Limite do ano" v={formatBRL(report.limitCents)} />
              <Row k="Faturado (competência)" v={formatBRL(report.grossCents)} />
              {report.reversalsCents ? <Row k="Devoluções já descontadas" v={formatBRL(report.reversalsCents)} muted /> : null}
              <Row k="Disponível" v={formatBRL(report.remainingCents)} strong danger={report.remainingCents < 0} />
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Faturamento mês a mês" subtitle={`Ritmo ideal: até ${formatBRL(monthlyPace)} por mês para não ultrapassar o limite`} />
          <CardBody>
            <BarChart labels={monthly.map((_, i) => monthLabel(i + 1))} series={[{ name: "Faturamento (competência)", values: monthly, color: "var(--brand)" }]} height={180} />
            <div
              className={cn(
                "mt-4 flex items-start gap-3 rounded-2xl p-3.5 text-[13px]",
                report.status === "normal" || report.status === "sem_atividade" ? "bg-accent-soft text-accent" : report.usedBp >= 10000 ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
              )}
            >
              {report.status === "normal" ? <ShieldCheck size={18} className="mt-px shrink-0" /> : <AlertTriangle size={18} className="mt-px shrink-0" />}
              <p>{STATUS_TEXT[report.status]}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {year === currentYear ? (
        <Card className="mt-4">
          <CardHeader title="Projeção para o fim do ano" subtitle="Estimativa gerencial pela média mensal — não é previsão fiscal" action={<Scale size={18} className="text-subtle" />} />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Média mensal" value={formatBRL(projection.monthlyAverageCents)} />
            <Tile label="Projeção anual" value={formatBRL(projection.projectedAnnualCents)} />
            <Tile label="Situação projetada" value={LIMIT_STATUS_LABEL[projection.projectedStatus]} tone={projection.projectedStatus === "normal" ? "ok" : "warn"} />
            <Tile label="Atinge o limite em" value={projection.breachMonth ? monthLabel(projection.breachMonth, true) : "Não neste ano"} tone={projection.breachMonth ? "warn" : "ok"} />
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`DAS ${year}`}
            subtitle={`Vencimento nominal dia 20 do mês seguinte · calendário ${CALENDAR_VERSION}`}
            action={pending.length ? <Badge tone="warn">{pending.length} pendente(s)</Badge> : <Badge tone="success">Em dia</Badge>}
          />
          <CardBody className="pt-3">
            <p className="mb-3 text-[12.5px] text-muted">Gere a guia no PGMEI (portal oficial) e registre aqui o pagamento com a referência do comprovante. O Fluxora não emite guias.</p>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {das.map((d) => (
                <li key={d.competence} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-20 shrink-0">
                    <div className="text-[13.5px] font-medium capitalize">
                      {monthLabel(Number(d.competence.slice(5)), false)}/{d.competence.slice(2, 4)}
                    </div>
                    <div className="text-[11px] text-subtle">competência</div>
                  </div>
                  <div className="min-w-0 flex-1 text-[12.5px] text-muted">
                    Vence {formatBizDate(d.nominalDueDate)}
                    {d.dueOnWeekend && d.status !== "pago" ? <span className="block text-warn">Cai em fim de semana: confira a data ajustada no PGMEI.</span> : null}
                    {d.payment ? (
                      <span className="block truncate">
                        Pago em {formatBizDate(d.payment.paidOn)} · {formatBRL(d.payment.amountCents)} · {d.payment.proofNote}
                      </span>
                    ) : null}
                  </div>
                  <Badge tone={d.status === "pago" ? "success" : d.status === "vencido" ? "danger" : d.status === "pendente" ? "warn" : "neutral"}>
                    {d.status === "pago" ? "Pago" : d.status === "vencido" ? "Sem registro" : d.status === "pendente" ? "A pagar" : "Futuro"}
                  </Badge>
                  {d.status === "pendente" || d.status === "vencido" ? (
                    <Button size="sm" variant="outline" onClick={() => setPaying(d)}>
                      Registrar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="DASN-SIMEI" subtitle={`Declaração anual · prazo nominal ${formatBizDate(data.dasnDue)}`} action={<FileClock size={18} className="text-subtle" />} />
            <CardBody className="pt-3 text-[13.5px]">
              {dasnBase ? (
                <>
                  <p className="mb-3 text-[12.5px] text-muted">Valores de {dasnBase.y} para conferir com seu contador antes de declarar:</p>
                  <dl className="space-y-1.5">
                    <Row k="Comércio/indústria" v={formatBRL(dasnBase.commerce)} />
                    <Row k="Serviços" v={formatBRL(dasnBase.services)} />
                    <Row k="Receita bruta total" v={formatBRL(dasnBase.total)} strong />
                  </dl>
                </>
              ) : (
                <p className="text-[12.5px] text-muted">
                  A primeira declaração será referente a {openedYear}, entregue em {openedYear + 1}.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Links oficiais" subtitle="Sempre confira no portal do governo" />
            <CardBody className="space-y-2 pt-3">
              <OfficialLink href="https://www.gov.br/empresas-e-negocios/pt-br/empreendedor" label="Portal do Empreendedor (PGMEI, DASN-SIMEI)" />
              <OfficialLink href="https://www.gov.br/nfse/" label="NFS-e Nacional" />
            </CardBody>
          </Card>
        </div>
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-[12px] text-subtle">
        <History size={13} /> Cálculos gerenciais com dados fictícios. Regras parametrizadas por vigência e sujeitas a revisão contábil.
      </p>

      {paying ? (
        <DasModal
          obligation={paying}
          onClose={() => setPaying(null)}
          onSubmit={(amount, paidOn, proof) => {
            const r = act((s, c) => registerDasPayment(s, { competence: paying.competence, amountCents: amount, paidOn, proofNote: proof }, c), "Pagamento do DAS registrado.");
            if (r.ok) setPaying(null);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportHistory
          openedOn={t.state.tenant.openedOn}
          onClose={() => setImportOpen(false)}
          onSubmit={(competenceDate, amount, description) => {
            const r = act((s, c) => importHistoricalRevenue(s, { competenceDate, amountCents: amount, description }, c), "Histórico importado.");
            if (r.ok) setImportOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Row({ k, v, strong, muted, danger }: { k: string; v: string; strong?: boolean; muted?: boolean; danger?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "border-t border-line pt-2 font-semibold", muted && "text-muted")}>
      <dt className={cn(!strong && "text-muted")}>{k}</dt>
      <dd className={cn("tabular", danger && "text-danger")}>{v}</dd>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cn("mt-1 text-[14.5px] font-semibold tabular capitalize-first", tone === "warn" && "text-warn", tone === "ok" && "text-accent")}>{value}</div>
    </div>
  );
}

function OfficialLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-[13px] font-medium hover:bg-surface-2">
      {label}
      <ExternalLink size={14} className="shrink-0 text-subtle" />
    </a>
  );
}

function DasModal({ obligation, onClose, onSubmit }: { obligation: DasObligation; onClose: () => void; onSubmit: (amount: number, paidOn: string, proof: string) => void }) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayBiz());
  const [proof, setProof] = useState("");
  const cents = amount ? safeParse(() => parseCents(amount)) : null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Registrar DAS ${obligation.competence}`}
      description="Informe os dados do comprovante de pagamento da guia gerada no PGMEI."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={cents === null || proof.trim().length < 3} onClick={() => onSubmit(cents!, paidOn, proof)}>
            <CalendarCheck2 size={16} /> Registrar pagamento
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor pago" hint="Valor da guia.">
            {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="Data do pagamento">{(id) => <Input id={id} type="date" value={paidOn} max={todayBiz()} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
        </div>
        <Field label="Referência do comprovante" hint="Ex.: autenticação bancária ou número do documento.">
          {(id) => <Input id={id} value={proof} maxLength={120} onChange={(e) => setProof(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function ImportHistory({ openedOn, onClose, onSubmit }: { openedOn: string; onClose: () => void; onSubmit: (date: string, amount: number, desc: string) => void }) {
  const [month, setMonth] = useState(todayBiz().slice(0, 7));
  const [amount, setAmount] = useState("");
  const cents = amount ? safeParse(() => parseCents(amount)) : null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Importar faturamento anterior"
      description="Para empresas que começaram a usar o Fluxora no meio do ano: informe o faturamento de cada mês anterior."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={cents === null} onClick={() => onSubmit(`${month}-01`, cents!, `Histórico importado ${month}`)}>
            Importar mês
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mês (competência)">
          {(id) => <Input id={id} type="month" value={month} min={openedOn.slice(0, 7)} max={todayBiz().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />}
        </Field>
        <Field label="Faturamento do mês">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
