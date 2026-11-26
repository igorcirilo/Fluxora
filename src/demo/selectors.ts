import { addDays, compareBiz, monthLabel, monthStart, nextMonthStart, parts, type BizDate } from "@/modules/finance/dates";
import { accountBalance, cashReport } from "@/modules/finance/cash";
import { simpleDre } from "@/modules/finance/dre";
import { openCents, titleStatus, type Title } from "@/modules/finance/titles";
import { stockBalances } from "@/modules/inventory/stock";
import { limitReport, monthlyRevenue, projectLimit, type LimitStatus } from "@/modules/mei/limit";
import { resolveRule } from "@/modules/mei/rules";
import { dasSchedule, dasnDueDate } from "@/modules/mei/calendar";
import type { TenantState } from "@/modules/tenants/state";

export type PeriodKind = "mes" | "mes_anterior" | "ano";

export interface Period {
  kind: PeriodKind;
  start: BizDate;
  end: BizDate; // exclusivo
  label: string;
}

export function periodOf(kind: PeriodKind, today: BizDate): Period {
  const { year, month } = parts(today);
  if (kind === "ano") return { kind, start: `${year}-01-01`, end: `${year + 1}-01-01`, label: `Ano de ${year}` };
  if (kind === "mes_anterior") {
    const y = month === 1 ? year - 1 : year;
    const m = month === 1 ? 12 : month - 1;
    return { kind, start: monthStart(y, m), end: nextMonthStart(y, m), label: `${monthLabel(m, true)} de ${y}` };
  }
  return { kind, start: monthStart(year, month), end: nextMonthStart(year, month), label: `${monthLabel(month, true)} de ${year}` };
}

export function cogsInRange(state: TenantState, start: BizDate, end: BizDate): number {
  let total = 0;
  for (const s of state.sales) {
    if (s.status === "devolvida" || compareBiz(s.date, start) < 0 || compareBiz(s.date, end) >= 0) continue;
    for (const i of s.items) total += i.unitCostCents * i.quantity;
  }
  return total;
}

export function kpis(state: TenantState, p: Period, today: BizDate) {
  const cash = cashReport(state.movements, p.start, p.end);
  const dre = simpleDre({ revenues: state.revenues, cogsCents: cogsInRange(state, p.start, p.end), movements: state.movements, start: p.start, end: p.end });
  const tomorrow = addDays(today, 1);
  const balance = state.accounts.reduce((s, a) => s + accountBalance(state.movements, a.id, tomorrow), 0);
  const receivables = state.titles.filter((t) => t.kind === "receivable" && openCents(t) > 0);
  const payables = state.titles.filter((t) => t.kind === "payable" && openCents(t) > 0);
  const salesInPeriod = state.sales.filter((s) => s.status === "concluida" && compareBiz(s.date, p.start) >= 0 && compareBiz(s.date, p.end) < 0);
  return {
    revenue: dre.netRevenueCents,
    cashIn: cash.incomingCents,
    cashOut: cash.outgoingCents,
    balance,
    receivableOpen: receivables.reduce((s, t) => s + openCents(t), 0),
    receivableOverdue: receivables.filter((t) => titleStatus(t, today) === "vencido"),
    payableOpen: payables.reduce((s, t) => s + openCents(t), 0),
    expenses: dre.expensesCents + dre.feesCents,
    dre,
    salesCount: salesInPeriod.length,
    ticket: salesInPeriod.length ? Math.round(salesInPeriod.reduce((s, x) => s + x.totalCents, 0) / salesInPeriod.length) : 0,
  };
}

export function meiSummary(state: TenantState, today: BizDate, year = parts(today).year) {
  const rule = resolveRule(state.tenant.regime, year);
  const report = limitReport({ entries: state.revenues, openedOn: state.tenant.openedOn, year, regime: state.tenant.regime });
  const projection = projectLimit(report, today, state.tenant.openedOn, rule);
  const monthly = monthlyRevenue(state.revenues, year);
  const das = dasSchedule({ year, openedOn: state.tenant.openedOn, today, payments: state.dasPayments });
  const prevYearDas = year - 1 >= parts(state.tenant.openedOn).year ? dasSchedule({ year: year - 1, openedOn: state.tenant.openedOn, today, payments: state.dasPayments }) : [];
  return { rule, report, projection, monthly, das, prevYearDas, dasnDue: dasnDueDate(year - 1) };
}

export const LIMIT_TONE: Record<LimitStatus, "success" | "warn" | "danger" | "brand"> = {
  sem_atividade: "brand",
  normal: "success",
  monitorar: "warn",
  atencao: "warn",
  limite_atingido: "danger",
  excesso_ate_20: "danger",
  excesso_acima_20: "danger",
};

export const LIMIT_COLOR: Record<LimitStatus, string> = {
  sem_atividade: "var(--brand)",
  normal: "var(--accent)",
  monitorar: "var(--warn)",
  atencao: "#f07b12",
  limite_atingido: "var(--danger)",
  excesso_ate_20: "var(--danger)",
  excesso_acima_20: "var(--danger)",
};

export function lowStock(state: TenantState) {
  const bal = stockBalances(state.stockMovements);
  return state.products
    .filter((p) => p.active && p.trackStock)
    .map((p) => ({ product: p, balance: bal.get(p.id) ?? 0 }))
    .filter((x) => x.balance <= x.product.minStock)
    .sort((a, b) => a.balance - b.balance);
}

export interface Alert {
  id: string;
  tone: "warn" | "danger" | "info";
  title: string;
  detail: string;
  href: string;
}

export function alerts(state: TenantState, today: BizDate): Alert[] {
  const out: Alert[] = [];
  const mei = meiSummary(state, today);
  if (["monitorar", "atencao", "limite_atingido", "excesso_ate_20", "excesso_acima_20"].includes(mei.report.status)) {
    out.push({
      id: "limit",
      tone: mei.report.usedBp >= 9000 ? "danger" : "warn",
      title: `Limite MEI em ${(mei.report.usedBp / 100).toFixed(1).replace(".", ",")}%`,
      detail: "Converse com seu contador antes de ultrapassar o limite.",
      href: "/meu-mei",
    });
  }
  const overdueRec = state.titles.filter((t) => t.kind === "receivable" && titleStatus(t, today) === "vencido");
  if (overdueRec.length)
    out.push({
      id: "rec",
      tone: "warn",
      title: `${overdueRec.length} recebíve${overdueRec.length > 1 ? "is" : "l"} vencido${overdueRec.length > 1 ? "s" : ""}`,
      detail: "Cobre pelo WhatsApp a partir da ficha do cliente.",
      href: "/financeiro?aba=receber",
    });
  const overduePay = state.titles.filter((t) => t.kind === "payable" && titleStatus(t, today) === "vencido");
  if (overduePay.length)
    out.push({
      id: "pay",
      tone: "danger",
      title: `${overduePay.length} conta${overduePay.length > 1 ? "s" : ""} a pagar vencida${overduePay.length > 1 ? "s" : ""}`,
      detail: "Evite juros: registre o pagamento quando quitar.",
      href: "/financeiro?aba=pagar",
    });
  const low = lowStock(state);
  if (low.length)
    out.push({
      id: "stock",
      tone: "warn",
      title: `${low.length} produto${low.length > 1 ? "s" : ""} com estoque baixo`,
      detail:
        low
          .slice(0, 2)
          .map((l) => l.product.name)
          .join(", ") + (low.length > 2 ? "…" : ""),
      href: "/produtos?filtro=baixo",
    });
  const das = mei.das.find((d) => d.status === "vencido") ?? mei.das.find((d) => d.status === "pendente" && compareBiz(d.nominalDueDate, addDays(today, 10)) <= 0);
  if (das)
    out.push({
      id: "das",
      tone: das.status === "vencido" ? "danger" : "info",
      title: das.status === "vencido" ? `DAS ${das.competence} sem pagamento registrado` : `DAS ${das.competence} vence em breve`,
      detail: "Gere a guia no PGMEI e registre o comprovante aqui.",
      href: "/meu-mei",
    });
  return out;
}

export interface AgendaItem {
  date: BizDate;
  title: string;
  amount?: number;
  kind: "pagar" | "receber" | "das" | "dasn";
  href: string;
}

export function agenda(state: TenantState, today: BizDate, days = 30): AgendaItem[] {
  const until = addDays(today, days);
  const items: AgendaItem[] = [];
  const pushTitle = (t: Title) =>
    items.push({
      date: t.dueDate,
      title: t.description,
      amount: openCents(t),
      kind: t.kind === "payable" ? "pagar" : "receber",
      href: `/financeiro?aba=${t.kind === "payable" ? "pagar" : "receber"}`,
    });
  for (const t of state.titles) if (openCents(t) > 0 && compareBiz(t.dueDate, today) >= 0 && compareBiz(t.dueDate, until) <= 0) pushTitle(t);
  const mei = meiSummary(state, today);
  for (const d of [...mei.prevYearDas, ...mei.das])
    if (d.status !== "pago" && compareBiz(d.nominalDueDate, today) >= 0 && compareBiz(d.nominalDueDate, until) <= 0)
      items.push({ date: d.nominalDueDate, title: `DAS competência ${d.competence}`, kind: "das", href: "/meu-mei" });
  if (compareBiz(mei.dasnDue, today) >= 0 && compareBiz(mei.dasnDue, until) <= 0) items.push({ date: mei.dasnDue, title: "DASN-SIMEI (declaração anual)", kind: "dasn", href: "/meu-mei" });
  return items.sort((a, b) => compareBiz(a.date, b.date));
}

export function topProducts(state: TenantState, p: Period, limit = 5) {
  const map = new Map<string, { name: string; qty: number; total: number }>();
  for (const s of state.sales) {
    if (s.status !== "concluida" || compareBiz(s.date, p.start) < 0 || compareBiz(s.date, p.end) >= 0) continue;
    for (const i of s.items) {
      const cur = map.get(i.productId) ?? { name: i.name, qty: 0, total: 0 };
      cur.qty += i.quantity;
      cur.total += i.totalCents;
      map.set(i.productId, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Série de 6 meses: receita (competência) × entradas de caixa. */
export function sixMonthSeries(state: TenantState, today: BizDate) {
  const { year, month } = parts(today);
  const labels: string[] = [];
  const revenue: number[] = [];
  const cashIn: number[] = [];
  for (let k = 5; k >= 0; k--) {
    const total = year * 12 + (month - 1) - k;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    labels.push(monthLabel(m));
    const start = monthStart(y, m);
    const end = nextMonthStart(y, m);
    revenue.push(simpleDre({ revenues: state.revenues, cogsCents: 0, movements: [], start, end }).netRevenueCents);
    const c = cashReport(state.movements, start, end);
    cashIn.push((c.byCategory.sale_receipt?.in ?? 0) + (c.byCategory.receivable_settlement?.in ?? 0));
  }
  return { labels, revenue, cashIn };
}
