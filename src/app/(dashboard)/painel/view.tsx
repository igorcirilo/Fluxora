"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, CalendarDays, CircleDollarSign, Info, Landmark, PiggyBank, Receipt, ScanLine, TrendingUp, Wallet, Package, Plus } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { agenda, alerts, kpis, LIMIT_COLOR, LIMIT_TONE, meiSummary, periodOf, sixMonthSeries, topProducts, type PeriodKind } from "@/demo/selectors";
import { formatBRL } from "@/modules/finance/money";
import { formatBizDateShort, todayBiz } from "@/modules/finance/dates";
import { LIMIT_STATUS_LABEL } from "@/modules/mei/limit";
import { Badge, BarChart, Button, Card, CardBody, CardHeader, EmptyState, Gauge, InfoTip, PageHeader, Segmented, cn } from "@/components/ui";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function DashboardView() {
  const t = useTenant();
  const [period, setPeriod] = useState<PeriodKind>("mes");
  const today = todayBiz();
  const data = useMemo(() => {
    if (!t) return null;
    const p = periodOf(period, today);
    return {
      p,
      k: kpis(t.state, p, today),
      mei: meiSummary(t.state, today),
      al: alerts(t.state, today),
      ag: agenda(t.state, today, 30),
      series: sixMonthSeries(t.state, today),
      top: topProducts(t.state, p),
    };
  }, [t, period, today]);
  if (!t || !data) return null;
  const { p, k, mei, al, ag, series, top } = data;
  const empty = t.state.sales.length === 0 && t.state.movements.length === 0;
  const firstName = t.userName.split(" ")[0];

  return (
    <div className="animate-in">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={
          <>
            Resumo de <b className="font-medium text-fg">{p.label}</b> · {t.state.tenant.tradeName}
          </>
        }
        actions={
          <>
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "mes", label: "Este mês" },
                { value: "mes_anterior", label: "Mês anterior" },
                { value: "ano", label: "Ano" },
              ]}
            />
            <Link href="/pdv" className="hidden sm:block">
              <Button>
                <ScanLine size={16} /> Nova venda
              </Button>
            </Link>
          </>
        }
      />

      {empty ? (
        <Onboarding />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi
              icon={<TrendingUp size={16} />}
              label="Receita bruta"
              value={k.revenue}
              period={p.label}
              hint={`${k.salesCount} vendas · ticket médio ${formatBRL(k.ticket)}`}
              definition="Soma das vendas e serviços pela data da venda (competência), descontados devoluções. Não é dinheiro recebido nem lucro. É a base do limite MEI."
              accent
            />
            <Kpi
              icon={<CircleDollarSign size={16} />}
              label="Caixa realizado"
              value={k.cashIn}
              period={p.label}
              hint="Entradas efetivamente recebidas"
              definition="Dinheiro que de fato entrou nas contas no período: vendas à vista, Pix, recebimentos de fiado e cartão liquidados, aportes. Transferências entre contas não contam."
            />
            <Kpi
              icon={<Wallet size={16} />}
              label="Saldo atual"
              value={k.balance}
              period="Hoje, todas as contas"
              hint="Gaveta + conta PJ"
              definition="Saldo inicial + recebimentos − pagamentos, até hoje. Caixa não é lucro: pode haver contas a pagar."
            />
            <Kpi
              icon={<Receipt size={16} />}
              label="A receber"
              value={k.receivableOpen}
              period="Em aberto"
              hint={k.receivableOverdue.length ? `${k.receivableOverdue.length} vencido(s)` : "Nada vencido"}
              hintTone={k.receivableOverdue.length ? "warn" : undefined}
              definition="Fiado e cartão de crédito ainda não liquidados. Entram no caixa só quando recebidos."
            />
            <Kpi
              icon={<Landmark size={16} />}
              label="Despesas pagas"
              value={k.expenses}
              period={p.label}
              hint={`A pagar em aberto: ${formatBRL(k.payableOpen)}`}
              definition="Despesas e contas pagas no período (inclui taxas). Retiradas do titular não entram aqui."
            />
            <Kpi
              icon={<PiggyBank size={16} />}
              label="Margem estimada"
              valueText={`${(k.dre.marginBp / 100).toFixed(1).replace(".", ",")}%`}
              period={p.label}
              hint={`Resultado ${formatBRL(k.dre.operatingResultCents)}`}
              hintTone={k.dre.operatingResultCents < 0 ? "danger" : undefined}
              definition="(Receita líquida − custo dos produtos vendidos − despesas pagas) ÷ receita líquida. Estimativa gerencial: depende do custo cadastrado."
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Receita × caixa"
                subtitle="Últimos 6 meses · competência versus recebido de vendas"
                action={
                  <InfoTip text="Barras roxas: receita bruta pela data da venda. Barras verdes: o que foi recebido de vendas no mês (inclui fiado e cartão liquidados). A diferença mostra o prazo de recebimento." />
                }
              />
              <CardBody>
                <BarChart
                  labels={series.labels}
                  series={[
                    { name: "Receita (competência)", values: series.revenue, color: "var(--brand)" },
                    { name: "Recebido de vendas (caixa)", values: series.cashIn, color: "var(--accent)" },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Limite do MEI"
                subtitle={`${mei.report.year} · ${mei.report.activeMonths} ${mei.report.activeMonths === 1 ? "mês" : "meses"} de atividade`}
                action={<Badge tone={LIMIT_TONE[mei.report.status] === "brand" ? "brand" : LIMIT_TONE[mei.report.status]}>{LIMIT_STATUS_LABEL[mei.report.status]}</Badge>}
              />
              <CardBody className="pt-2">
                <Gauge valueBp={mei.report.usedBp} color={LIMIT_COLOR[mei.report.status]}>
                  <div className="text-[30px] font-semibold tracking-tight tabular">{(mei.report.usedBp / 100).toFixed(1).replace(".", ",")}%</div>
                  <div className="text-[12px] text-muted">utilizado</div>
                </Gauge>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <dt className="text-muted">Faturado no ano</dt>
                    <dd className="mt-0.5 font-semibold tabular">{formatBRL(mei.report.grossCents)}</dd>
                  </div>
                  <div className="rounded-xl bg-surface-2 p-3">
                    <dt className="text-muted">Ainda disponível</dt>
                    <dd className={cn("mt-0.5 font-semibold tabular", mei.report.remainingCents < 0 && "text-danger")}>{formatBRL(mei.report.remainingCents)}</dd>
                  </div>
                </dl>
                <Link href="/meu-mei" className="mt-3 flex items-center justify-between rounded-xl px-1 py-1 text-[13px] font-medium text-brand">
                  Ver projeção e DAS <ArrowRight size={15} />
                </Link>
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Alertas" subtitle="O que merece sua atenção" />
              <CardBody className="space-y-2">
                {al.length === 0 ? (
                  <p className="rounded-xl bg-accent-soft p-3 text-[13px] text-accent">Tudo em dia por aqui. 🎉</p>
                ) : (
                  al.map((a) => (
                    <Link key={a.id} href={a.href} className="flex items-start gap-3 rounded-xl border border-line p-3 transition hover:bg-surface-2">
                      <span
                        className={cn(
                          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                          a.tone === "danger" ? "bg-danger-soft text-danger" : a.tone === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info",
                        )}
                      >
                        {a.tone === "info" ? <Info size={15} /> : <AlertTriangle size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium">{a.title}</span>
                        <span className="block truncate text-[12.5px] text-muted">{a.detail}</span>
                      </span>
                      <ArrowUpRight size={15} className="mt-1 text-subtle" />
                    </Link>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Próximos 30 dias" subtitle="Vencimentos e obrigações" action={<CalendarDays size={18} className="text-subtle" />} />
              <CardBody className="pt-3">
                {ag.length === 0 ? (
                  <p className="text-[13px] text-muted">Nenhum vencimento nos próximos 30 dias.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {ag.slice(0, 6).map((a, i) => (
                      <li key={i}>
                        <Link href={a.href} className="flex items-center gap-3 py-2.5">
                          <span className="w-14 shrink-0 text-[12px] font-medium text-muted tabular">{formatBizDateShort(a.date)}</span>
                          <span className="min-w-0 flex-1 truncate text-[13.5px]">{a.title}</span>
                          {a.amount !== undefined ? (
                            <span className={cn("text-[13px] font-medium tabular", a.kind === "pagar" ? "text-danger" : "text-accent")}>
                              {a.kind === "pagar" ? "−" : "+"}
                              {formatBRL(a.amount)}
                            </span>
                          ) : (
                            <Badge tone={a.kind === "das" ? "info" : "brand"}>{a.kind === "das" ? "DAS" : "DASN"}</Badge>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Mais vendidos" subtitle={p.label} action={<Package size={18} className="text-subtle" />} />
              <CardBody className="pt-3">
                {top.length === 0 ? (
                  <p className="text-[13px] text-muted">Sem vendas no período.</p>
                ) : (
                  <ul className="space-y-3">
                    {top.map((x, i) => (
                      <li key={x.name}>
                        <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                          <span className="truncate">
                            <span className="mr-2 text-subtle tabular">{i + 1}.</span>
                            {x.name}
                          </span>
                          <span className="shrink-0 font-medium tabular">{formatBRL(x.total)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent" style={{ width: `${(x.total / top[0]!.total) * 100}%` }} />
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-subtle">{x.qty} unid.</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <p className="mt-6 text-center text-[12px] text-subtle">Indicadores gerenciais com dados fictícios. Caixa não equivale a lucro. Não substitui a orientação do contador.</p>
        </>
      )}

      <Link href="/pdv" className="fixed right-4 bottom-24 z-30 sm:hidden" aria-label="Nova venda">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-[0_10px_30px_-8px_var(--brand)]">
          <ScanLine size={24} />
        </span>
      </Link>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  valueText,
  period,
  hint,
  hintTone,
  definition,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueText?: string;
  period: string;
  hint?: string;
  hintTone?: "warn" | "danger";
  definition: string;
  accent?: boolean;
}) {
  return (
    <Card className={cn("relative p-4", accent && "border-brand/25 bg-gradient-to-b from-brand-soft/70 to-surface")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[12.5px] leading-tight font-medium text-muted">
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-lg", accent ? "bg-brand text-white" : "bg-surface-2 text-fg")}>{icon}</span>
          <span>{label}</span>
        </span>
        <InfoTip
          text={
            <>
              <b className="text-fg">{label}</b> · {period}
              <br />
              {definition}
            </>
          }
          label={`Definição de ${label}`}
        />
      </div>
      <div className="mt-3 truncate text-[19px] font-semibold tracking-tight tabular sm:text-[21px]">{valueText ?? formatBRL(value ?? 0)}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-subtle">{period}</div>
      {hint ? <div className={cn("mt-1.5 truncate text-[12px]", hintTone === "warn" ? "text-warn" : hintTone === "danger" ? "text-danger" : "text-muted")}>{hint}</div> : null}
    </Card>
  );
}

function Onboarding() {
  const steps = [
    { href: "/produtos", title: "Cadastre seus produtos ou serviços", text: "Nome, preço e, se quiser, estoque e custo.", icon: Package },
    { href: "/pdv", title: "Registre a primeira venda", text: "Abra o caixa e venda em poucos toques.", icon: ScanLine },
    { href: "/meu-mei", title: "Importe o faturamento anterior", text: "Para o limite MEI do ano ficar correto.", icon: TrendingUp },
  ];
  return (
    <Card>
      <EmptyState icon={<Plus size={24} />} title="Vamos começar?" description="Sua empresa ainda não tem movimentações. Siga os passos abaixo — leva poucos minutos." />
      <div className="grid gap-3 px-4 pb-5 sm:grid-cols-3 sm:px-5">
        {steps.map(({ href, title, text, icon: Icon }, i) => (
          <Link key={href} href={href} className="group rounded-2xl border border-line p-4 transition hover:border-brand/40 hover:bg-brand-soft/40">
            <div className="flex items-center gap-2 text-[12px] font-medium text-brand">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-soft">{i + 1}</span>
              Passo {i + 1}
            </div>
            <Icon size={20} className="mt-3 text-fg" />
            <div className="mt-2 text-[14px] font-semibold">{title}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{text}</div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
