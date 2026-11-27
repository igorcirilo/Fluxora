import { compareBiz, parts, type BizDate } from "@/modules/finance/dates";
import { openCents, titleStatus } from "@/modules/finance/titles";
import { limitReport, type LimitStatus } from "@/modules/mei/limit";
import { dasSchedule } from "@/modules/mei/calendar";
import { nfceReadiness } from "@/modules/fiscal/nfce";
import { fiscalSettingsOf } from "@/modules/fiscal/settings-ops";
import type { TenantState } from "@/modules/tenants/state";

/**
 * Resumo de uma empresa cliente para o painel do contador (somente leitura).
 * Usa apenas dados agregados; nenhum dado pessoal de clientes finais.
 */
export interface ClientSummary {
  tenantId: string;
  tradeName: string;
  name: string;
  openedOn: BizDate;
  segment: string;
  year: number;
  grossCents: number;
  limitCents: number;
  usedBp: number;
  limitStatus: LimitStatus;
  dasOverdue: string[];
  dasPending: string[];
  receivablesOverdueCents: number;
  payablesOverdueCents: number;
  salesThisMonth: number;
  lastSaleDate: BizDate | null;
  nfceDone: number;
  nfceTotal: number;
  attention: number; // quantos pontos pedem atenção
}

export function clientSummary(state: TenantState, today: BizDate): ClientSummary {
  const { year, month } = parts(today);
  const report = limitReport({ entries: state.revenues, openedOn: state.tenant.openedOn, year, regime: state.tenant.regime });
  const das = parts(state.tenant.openedOn).year <= year ? dasSchedule({ year, openedOn: state.tenant.openedOn, today, payments: state.dasPayments }) : [];
  const overdue = (k: "receivable" | "payable") => state.titles.filter((t) => t.kind === k && titleStatus(t, today) === "vencido").reduce((s, t) => s + openCents(t), 0);
  const done = state.sales.filter((s) => s.status === "concluida");
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const last = done.reduce<BizDate | null>((m, s) => (!m || compareBiz(s.date, m) > 0 ? s.date : m), null);
  const readiness = nfceReadiness(fiscalSettingsOf(state), state.products, false);
  const s: ClientSummary = {
    tenantId: state.tenant.id,
    tradeName: state.tenant.tradeName,
    name: state.tenant.name,
    openedOn: state.tenant.openedOn,
    segment: state.tenant.segment,
    year,
    grossCents: report.grossCents,
    limitCents: report.limitCents,
    usedBp: report.usedBp,
    limitStatus: report.status,
    dasOverdue: das.filter((d) => d.status === "vencido").map((d) => d.competence),
    dasPending: das.filter((d) => d.status === "pendente").map((d) => d.competence),
    receivablesOverdueCents: overdue("receivable"),
    payablesOverdueCents: overdue("payable"),
    salesThisMonth: done.filter((x) => x.date.startsWith(monthPrefix)).length,
    lastSaleDate: last,
    nfceDone: readiness.items.filter((i) => i.status === "ok").length,
    nfceTotal: readiness.items.length,
    attention: 0,
  };
  s.attention = (s.usedBp >= 8000 ? 1 : 0) + (s.dasOverdue.length ? 1 : 0) + (s.payablesOverdueCents > 0 ? 1 : 0) + (s.receivablesOverdueCents > 0 ? 1 : 0);
  return s;
}

export function summariesCsv(rows: ClientSummary[]): (string | number)[][] {
  return [
    ["empresa", "razao_social", "abertura", "ano", "faturamento", "limite", "uso_limite_pct", "situacao_limite", "das_vencidos", "das_a_pagar", "receber_vencido", "pagar_vencido", "vendas_mes", "ultima_venda", "nfce_etapas"],
    ...rows.map((r) => [
      r.tradeName,
      r.name,
      r.openedOn,
      r.year,
      (r.grossCents / 100).toFixed(2),
      (r.limitCents / 100).toFixed(2),
      (r.usedBp / 100).toFixed(1),
      r.limitStatus,
      r.dasOverdue.join(" "),
      r.dasPending.join(" "),
      (r.receivablesOverdueCents / 100).toFixed(2),
      (r.payablesOverdueCents / 100).toFixed(2),
      r.salesThisMonth,
      r.lastSaleDate ?? "",
      `${r.nfceDone}/${r.nfceTotal}`,
    ]),
  ];
}
