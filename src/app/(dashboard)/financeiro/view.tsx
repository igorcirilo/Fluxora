"use client";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, Plus, RotateCcw, TrendingDown, TrendingUp, Wallet, CalendarClock } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { safeParse, useAction } from "@/components/use-action";
import { downloadCsv } from "@/components/csv";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, InfoTip, Input, Modal, MoneyInput, PageHeader, Segmented, Select, cn } from "@/components/ui";
import { centsToInput, formatBRL, parseCents } from "@/modules/finance/money";
import { addDays, compareBiz, formatBizDate, monthLabel, monthStart, nextMonthStart, parts, todayBiz } from "@/modules/finance/dates";
import { accountBalance, monthlyCashReport, type CashCategory } from "@/modules/finance/cash";
import { simpleDre } from "@/modules/finance/dre";
import { openCents, settledCents, titleStatus, type Title, type TitleKind } from "@/modules/finance/titles";
import { cogsInRange } from "@/demo/selectors";
import type { TenantState } from "@/modules/tenants/state";

type Tab = "geral" | "receber" | "pagar" | "lancamentos";

const CATEGORY_LABEL: Record<CashCategory, string> = {
  opening_balance: "Saldo inicial",
  sale_receipt: "Vendas recebidas",
  receivable_settlement: "Recebimentos (fiado/cartão)",
  other_income: "Outras entradas",
  expense: "Despesas",
  payable_settlement: "Contas pagas",
  inventory_purchase: "Compras de mercadoria",
  fee: "Taxas",
  owner_withdrawal: "Retiradas do titular",
  capital_contribution: "Aportes do titular",
  loan: "Empréstimos recebidos",
  transfer: "Transferências",
  refund: "Reembolsos",
  reversal: "Estornos",
};

export function FinanceView() {
  const t = useTenant();
  const params = useSearchParams();
  const initial = (params.get("aba") as Tab) ?? "geral";
  const [tab, setTab] = useState<Tab>(["geral", "receber", "pagar", "lancamentos"].includes(initial) ? initial : "geral");
  const today = todayBiz();
  const [ym, setYm] = useState(() => ({ y: parts(today).year, m: parts(today).month }));
  const [modal, setModal] = useState<null | "lancamento" | "transferencia" | "titulo-receber" | "titulo-pagar">(null);
  if (!t) return null;
  const shift = (d: number) =>
    setYm(({ y, m }) => {
      const total = y * 12 + (m - 1) + d;
      return { y: Math.floor(total / 12), m: (total % 12) + 1 };
    });
  const isCurrent = ym.y === parts(today).year && ym.m === parts(today).month;

  return (
    <div className="animate-in">
      <PageHeader
        title="Financeiro"
        description="Competência, vencimento e liquidação separados. Transferências não são receita."
        actions={
          <>
            <Button variant="outline" onClick={() => setModal("transferencia")}>
              <ArrowLeftRight size={16} /> Transferir
            </Button>
            <Button onClick={() => setModal(tab === "receber" ? "titulo-receber" : tab === "pagar" ? "titulo-pagar" : "lancamento")}>
              <Plus size={16} /> {tab === "receber" ? "Conta a receber" : tab === "pagar" ? "Conta a pagar" : "Lançamento"}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "geral", label: "Visão geral" },
            { value: "receber", label: "A receber" },
            { value: "pagar", label: "A pagar" },
            { value: "lancamentos", label: "Lançamentos" },
          ]}
        />
        {tab === "geral" || tab === "lancamentos" ? (
          <div className="flex items-center gap-1 self-start rounded-xl border border-line bg-surface p-1 sm:self-auto">
            <Button variant="ghost" size="sm" aria-label="Mês anterior" onClick={() => shift(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-32 text-center text-[13.5px] font-medium capitalize">
              {monthLabel(ym.m, true)} {ym.y}
            </span>
            <Button variant="ghost" size="sm" aria-label="Próximo mês" disabled={isCurrent} onClick={() => shift(1)}>
              <ChevronRight size={16} />
            </Button>
          </div>
        ) : null}
      </div>

      {tab === "geral" ? <Overview state={t.state} y={ym.y} m={ym.m} today={today} /> : null}
      {tab === "receber" || tab === "pagar" ? (
        <Titles state={t.state} kind={tab === "receber" ? "receivable" : "payable"} today={today} onNew={() => setModal(tab === "receber" ? "titulo-receber" : "titulo-pagar")} />
      ) : null}
      {tab === "lancamentos" ? <Movements state={t.state} y={ym.y} m={ym.m} onNew={() => setModal("lancamento")} /> : null}

      {modal === "lancamento" ? <MovementForm onClose={() => setModal(null)} /> : null}
      {modal === "transferencia" ? <TransferForm state={t.state} onClose={() => setModal(null)} /> : null}
      {modal === "titulo-receber" || modal === "titulo-pagar" ? <TitleForm kind={modal === "titulo-receber" ? "receivable" : "payable"} state={t.state} onClose={() => setModal(null)} /> : null}
    </div>
  );
}

function Overview({ state, y, m, today }: { state: TenantState; y: number; m: number; today: string }) {
  const data = useMemo(() => {
    const cash = monthlyCashReport(state.movements, y, m);
    const start = monthStart(y, m);
    const end = nextMonthStart(y, m);
    const dre = simpleDre({ revenues: state.revenues, cogsCents: cogsInRange(state, start, end), movements: state.movements, start, end });
    const balances = state.accounts.map((a) => ({ a, b: accountBalance(state.movements, a.id, addDays(today, 1)) }));
    const in30 = addDays(today, 30);
    const due = (k: TitleKind) => state.titles.filter((t) => t.kind === k && openCents(t) > 0 && compareBiz(t.dueDate, in30) <= 0).reduce((s, t) => s + openCents(t), 0);
    const current = balances.reduce((s, x) => s + x.b, 0);
    return { cash, dre, balances, projection: { current, rec: due("receivable"), pay: due("payable") } };
  }, [state, y, m, today]);
  const { cash, dre, balances, projection } = data;
  const cats = Object.entries(cash.byCategory) as [CashCategory, { in: number; out: number }][];
  const projected = projection.current + projection.rec - projection.pay;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Fluxo de caixa do mês"
          subtitle="Saldo inicial + recebimentos − pagamentos (consolidado)"
          action={<InfoTip text="Considera somente valores efetivamente liquidados. Vendas a prazo entram aqui apenas quando recebidas. Transferências entre gaveta e conta PJ se anulam." />}
        />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Box label="Saldo inicial" value={cash.openingCents} />
            <Box label="Entradas" value={cash.incomingCents} tone="in" />
            <Box label="Saídas" value={cash.outgoingCents} tone="out" />
            <Box label="Saldo final" value={cash.balanceCents} strong />
          </div>
          <ul className="mt-5 space-y-2.5">
            {cats.length === 0 ? <p className="text-[13px] text-muted">Sem movimentos neste mês.</p> : null}
            {cats
              .sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out))
              .map(([k, v]) => {
                const max = Math.max(cash.incomingCents, cash.outgoingCents, 1);
                const val = v.in || v.out;
                return (
                  <li key={k}>
                    <div className="flex justify-between text-[13px]">
                      <span>{CATEGORY_LABEL[k]}</span>
                      <span className={cn("font-medium tabular", v.in ? "text-accent" : "text-danger")}>
                        {v.in ? "+" : "−"}
                        {formatBRL(val)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className={cn("h-full rounded-full", v.in ? "bg-accent" : "bg-danger/80")} style={{ width: `${(val / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
          </ul>
        </CardBody>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Saldos por conta" subtitle="Hoje" />
          <CardBody className="space-y-2">
            {balances.map(({ a, b }) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl bg-surface-2 p-3">
                <span className="flex items-center gap-2 text-[13.5px]">
                  <Wallet size={16} className="text-muted" />
                  {a.name}
                </span>
                <b className="tabular">{formatBRL(b)}</b>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Projeção 30 dias" subtitle="Saldo + a receber − a pagar com vencimento até 30 dias" action={<CalendarClock size={18} className="text-subtle" />} />
          <CardBody className="space-y-1.5 text-[13.5px]">
            <Line k="Saldo atual" v={projection.current} />
            <Line k="A receber (inclui vencidos)" v={projection.rec} sign="+" />
            <Line k="A pagar (inclui vencidos)" v={projection.pay} sign="−" />
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-[15px] font-semibold">
              <span>Saldo projetado</span>
              <span className={cn("tabular", projected < 0 && "text-danger")}>{formatBRL(projected)}</span>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card className="lg:col-span-3">
        <CardHeader
          title="DRE gerencial simplificada"
          subtitle={`${monthLabel(m, true)} de ${y} · receita por competência, despesas pagas`}
          action={<InfoTip text="Demonstrativo gerencial para tomada de decisão. O custo das mercadorias vem do custo cadastrado no produto. Não substitui a escrituração contábil." />}
        />
        <CardBody>
          <dl className="grid gap-x-10 gap-y-1.5 text-[13.5px] sm:grid-cols-2">
            <Line k="Receita bruta" v={dre.grossRevenueCents} />
            <Line k="(−) Devoluções" v={dre.reversalsCents} sign="−" />
            <Line k="(=) Receita líquida" v={dre.netRevenueCents} bold />
            <Line k="(−) Custo das mercadorias" v={dre.cogsCents} sign="−" />
            <Line k="(=) Lucro bruto" v={dre.grossProfitCents} bold />
            <Line k="(−) Despesas pagas" v={dre.expensesCents} sign="−" />
            <Line k="(−) Taxas" v={dre.feesCents} sign="−" />
            <div className="flex justify-between rounded-lg bg-brand-soft px-2 py-1 font-semibold text-brand">
              <span>
                (=) Resultado <span className="font-normal opacity-80">· margem {(dre.marginBp / 100).toFixed(1).replace(".", ",")}%</span>
              </span>
              <span className="tabular">{formatBRL(dre.operatingResultCents)}</span>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function Box({ label, value, tone, strong }: { label: string; value: number; tone?: "in" | "out"; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl p-3", strong ? "bg-brand text-white" : "bg-surface-2")}>
      <div className={cn("flex items-center gap-1 text-[12px]", strong ? "text-white/75" : "text-muted")}>
        {tone === "in" ? <TrendingUp size={13} className="text-accent" /> : tone === "out" ? <TrendingDown size={13} className="text-danger" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate text-[16px] font-semibold tabular">{formatBRL(value)}</div>
    </div>
  );
}

function Line({ k, v, sign, bold }: { k: string; v: number; sign?: "+" | "−"; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", bold && "font-semibold")}>
      <span className={cn(!bold && "text-muted")}>{k}</span>
      <span className="tabular">
        {sign && v ? sign : ""}
        {formatBRL(v)}
      </span>
    </div>
  );
}

function Titles({ state, kind, today, onNew }: { state: TenantState; kind: TitleKind; today: string; onNew: () => void }) {
  const act = useAction();
  const [show, setShow] = useState<"abertos" | "vencidos" | "liquidados">("abertos");
  const [settling, setSettling] = useState<Title | null>(null);
  const names = new Map([...state.customers, ...state.suppliers].map((c) => [c.id, c.name]));
  const all = state.titles.filter((t) => t.kind === kind && !t.cancelledAt);
  const list = all
    .filter((t) => (show === "liquidados" ? openCents(t) === 0 : show === "vencidos" ? titleStatus(t, today) === "vencido" : openCents(t) > 0))
    .sort((a, b) => (show === "liquidados" ? compareBiz(b.dueDate, a.dueDate) : compareBiz(a.dueDate, b.dueDate)));
  const totalOpen = all.reduce((s, t) => s + openCents(t), 0);
  const overdue = all.filter((t) => titleStatus(t, today) === "vencido");
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-[12.5px] text-muted">{kind === "receivable" ? "Total a receber" : "Total a pagar"}</div>
          <div className="mt-1 text-[19px] font-semibold tabular">{formatBRL(totalOpen)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[12.5px] text-muted">Vencidos</div>
          <div className={cn("mt-1 text-[19px] font-semibold tabular", overdue.length && "text-danger")}>{formatBRL(overdue.reduce((s, t) => s + openCents(t), 0))}</div>
        </Card>
        <div className="col-span-2 flex items-center sm:col-span-1 sm:justify-end">
          <Segmented
            size="sm"
            value={show}
            onChange={setShow}
            options={[
              { value: "abertos", label: "Em aberto" },
              { value: "vencidos", label: `Vencidos (${overdue.length})` },
              { value: "liquidados", label: "Liquidados" },
            ]}
          />
        </div>
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={24} />}
            title="Nada por aqui"
            description={kind === "receivable" ? "Vendas no fiado e no crédito aparecem aqui automaticamente." : "Cadastre contas a pagar com vencimento e parcelas."}
            action={<Button onClick={onNew}>{kind === "receivable" ? "Nova conta a receber" : "Nova conta a pagar"}</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.slice(0, 80).map((ti) => {
              const st = titleStatus(ti, today);
              return (
                <li key={ti.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="w-14 shrink-0 text-center">
                    <div className={cn("text-[15px] font-semibold tabular", st === "vencido" && "text-danger")}>{ti.dueDate.slice(8, 10)}</div>
                    <div className="text-[11px] text-muted uppercase">{monthLabel(parts(ti.dueDate).month)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{ti.description}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                      {ti.counterpartyId ? <span className="truncate">{names.get(ti.counterpartyId)}</span> : null}
                      <span>competência {formatBizDate(ti.competenceDate)}</span>
                      {settledCents(ti) > 0 && openCents(ti) > 0 ? <span>· pago {formatBRL(settledCents(ti))}</span> : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular">{formatBRL(openCents(ti) || ti.amountCents)}</div>
                    <Badge tone={st === "vencido" ? "danger" : st === "liquidado" ? "success" : st === "parcial" ? "info" : "neutral"}>
                      {st === "aberto" ? "Em aberto" : st[0]!.toUpperCase() + st.slice(1)}
                    </Badge>
                  </div>
                  {openCents(ti) > 0 ? (
                    <Button size="sm" variant="outline" onClick={() => setSettling(ti)}>
                      {kind === "receivable" ? "Receber" : "Pagar"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {settling ? (
        <SettleModal
          title={settling}
          onClose={() => setSettling(null)}
          onConfirm={async (amount, date, accountId) => {
            const r = await act("title.settle", { titleId: settling.id, amountCents: amount, date, accountId }, "Liquidação registrada.");
            if (r.ok) setSettling(null);
          }}
          accounts={state.accounts}
        />
      ) : null}
    </>
  );
}

function SettleModal({
  title,
  accounts,
  onClose,
  onConfirm,
}: {
  title: Title;
  accounts: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (amount: number, date: string, account: string) => void;
}) {
  const [amount, setAmount] = useState(centsToInput(openCents(title)));
  const [date, setDate] = useState(todayBiz());
  const [account, setAccount] = useState(accounts.find((a) => a.id === "acc-banco")?.id ?? accounts[0]!.id);
  const cents = safeParse(() => parseCents(amount));
  const tooMuch = cents !== null && cents > openCents(title);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title.kind === "receivable" ? "Registrar recebimento" : "Registrar pagamento"}
      description={`${title.description} · em aberto ${formatBRL(openCents(title))}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={cents === null || tooMuch} onClick={() => onConfirm(cents!, date, account)}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Valor" hint="Pode ser parcial." error={tooMuch ? "Maior que o saldo em aberto." : null}>
          {(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da liquidação">{(id) => <Input id={id} type="date" value={date} max={todayBiz()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Conta">
            {(id) => (
              <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Movements({ state, y, m, onNew }: { state: TenantState; y: number; m: number; onNew: () => void }) {
  const act = useAction();
  const start = monthStart(y, m);
  const end = nextMonthStart(y, m);
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const list = state.movements.filter((x) => compareBiz(x.date, start) >= 0 && compareBiz(x.date, end) < 0).sort((a, b) => compareBiz(b.date, a.date));
  const reversed = new Set(state.movements.filter((x) => x.reversalOf).map((x) => x.reversalOf));
  const [limit, setLimit] = useState(50);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={!list.length}
          onClick={() =>
            downloadCsv(`lancamentos-${y}-${String(m).padStart(2, "0")}.csv`, [
              ["data", "conta", "tipo", "categoria", "descricao", "valor"],
              ...list.map((x) => [
                x.date,
                accounts.get(x.accountId) ?? x.accountId,
                x.direction === "in" ? "entrada" : "saida",
                CATEGORY_LABEL[x.category],
                x.description,
                (((x.direction === "in" ? 1 : -1) * x.amountCents) / 100).toFixed(2),
              ]),
            ])
          }
        >
          <Download size={14} /> Exportar CSV
        </Button>
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Wallet size={24} />}
            title="Sem lançamentos no mês"
            description="Registre despesas, retiradas, aportes e outras entradas."
            action={<Button onClick={onNew}>Novo lançamento</Button>}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.slice(0, limit).map((x) => {
              const canReverse = !x.sourceId && !["transfer", "reversal", "opening_balance", "receivable_settlement", "payable_settlement", "inventory_purchase", "refund"].includes(x.category) && !reversed.has(x.id);
              return (
                <li key={x.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                      x.category === "transfer" ? "bg-info-soft text-info" : x.direction === "in" ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger",
                    )}
                  >
                    {x.category === "transfer" ? <ArrowLeftRight size={15} /> : x.direction === "in" ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={cn("truncate text-[13.5px]", reversed.has(x.id) && "text-subtle line-through")}>{x.description}</div>
                    <div className="truncate text-[12px] text-muted">
                      {formatBizDate(x.date)} · {CATEGORY_LABEL[x.category]} · {accounts.get(x.accountId)}
                    </div>
                  </div>
                  <span className={cn("text-[13.5px] font-semibold tabular", x.direction === "in" ? "text-accent" : "text-fg")}>
                    {x.direction === "in" ? "+" : "−"}
                    {formatBRL(x.amountCents)}
                  </span>
                  {canReverse ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Estornar ${x.description}`}
                      title="Estornar (mantém histórico)"
                      onClick={() => void act("movement.reverse", { movementId: x.id }, "Estorno registrado.")}
                    >
                      <RotateCcw size={15} />
                    </Button>
                  ) : (
                    <span className="w-10" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.length > limit ? (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 50)}>
              Carregar mais
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}

const MANUAL: { value: CashCategory; label: string; dir: "in" | "out"; hint: string }[] = [
  { value: "expense", label: "Despesa", dir: "out", hint: "Aluguel, energia, insumos pagos à vista." },
  { value: "fee", label: "Taxa", dir: "out", hint: "Tarifas bancárias e da maquininha." },
  { value: "owner_withdrawal", label: "Retirada do titular", dir: "out", hint: "Dinheiro para uso pessoal. Não é despesa da empresa." },
  { value: "other_income", label: "Outra entrada", dir: "in", hint: "Entrada operacional que não é venda." },
  { value: "capital_contribution", label: "Aporte do titular", dir: "in", hint: "Dinheiro pessoal colocado na empresa. Não é receita." },
  { value: "loan", label: "Empréstimo recebido", dir: "in", hint: "Não é receita e não conta para o limite MEI." },
];

function MovementForm({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const t = useTenant();
  const [cat, setCat] = useState<CashCategory>("expense");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayBiz());
  const [account, setAccount] = useState("acc-banco");
  const def = MANUAL.find((x) => x.value === cat)!;
  const cents = amount ? safeParse(() => parseCents(amount)) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Novo lançamento"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={cents === null || !desc.trim()}
            onClick={async () => {
              const r = await act("movement.add", { accountId: account, date, direction: def.dir, amountCents: cents!, category: cat as "expense", description: desc }, "Lançamento registrado.");
              if (r.ok) onClose();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MANUAL.map((x) => (
            <button
              key={x.value}
              type="button"
              onClick={() => setCat(x.value)}
              aria-pressed={cat === x.value}
              className={cn(
                "rounded-xl border p-2.5 text-left text-[12.5px] font-medium transition",
                cat === x.value ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-fg",
              )}
            >
              <span className={cn("mr-1", x.dir === "in" ? "text-accent" : "text-danger")}>{x.dir === "in" ? "↑" : "↓"}</span>
              {x.label}
            </button>
          ))}
        </div>
        <p className="rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">{def.hint}</p>
        <Field label="Descrição">{(id) => <Input id={id} value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} max={todayBiz()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Conta">
            {(id) => (
              <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
                {t?.state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TransferForm({ state, onClose }: { state: TenantState; onClose: () => void }) {
  const act = useAction();
  const [from, setFrom] = useState(state.accounts[0]!.id);
  const [to, setTo] = useState(state.accounts[1]?.id ?? state.accounts[0]!.id);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayBiz());
  const cents = amount ? safeParse(() => parseCents(amount)) : null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Transferência entre contas"
      description="Move saldo entre gaveta e conta PJ. Não é receita nem despesa."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={cents === null || from === to}
            onClick={async () => {
              const r = await act("transfer.create", { from, to, date, amountCents: cents!, description: "Transferência entre contas" }, "Transferência registrada.");
              if (r.ok) onClose();
            }}
          >
            Transferir
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="De">
            {(id) => (
              <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Para" error={from === to ? "Escolha contas diferentes." : null}>
            {(id) => (
              <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Data">{(id) => <Input id={id} type="date" value={date} max={todayBiz()} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
      </div>
    </Modal>
  );
}

function TitleForm({ kind, state, onClose }: { kind: TitleKind; state: TenantState; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    description: "",
    total: "",
    installments: "1",
    competence: todayBiz(),
    due: addDays(todayBiz(), 30),
    counterparty: "",
    category: kind === "receivable" ? "Serviço" : "Fornecedor",
  });
  const cents = f.total ? safeParse(() => parseCents(f.total)) : null;
  const n = Number(f.installments);
  const people = kind === "receivable" ? state.customers : state.suppliers;
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "receivable" ? "Nova conta a receber" : "Nova conta a pagar"}
      description="Competência (quando ocorreu), vencimento (quando vence) e liquidação (quando foi pago) são datas diferentes."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={cents === null || !f.description.trim() || !(n >= 1 && n <= 48)}
            onClick={async () => {
              const r = await act("title.create", { kind, description: f.description, counterpartyId: f.counterparty || undefined, competenceDate: f.competence, firstDueDate: f.due, totalCents: cents!, installments: n, category: f.category }, "Título(s) criado(s).");
              if (r.ok) onClose();
            }}
          >
            Criar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Descrição" className="sm:col-span-2">
          {(id) => <Input id={id} value={f.description} maxLength={150} onChange={(e) => setF({ ...f, description: e.target.value })} />}
        </Field>
        <Field label="Valor total">{(id) => <MoneyInput id={id} value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} />}</Field>
        <Field label="Parcelas" hint={cents && n > 1 ? `${n}× de ~${formatBRL(Math.floor(cents / n))}` : "Mensais."}>
          {(id) => <Input id={id} type="number" min={1} max={48} value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} />}
        </Field>
        <Field label="Competência">{(id) => <Input id={id} type="date" value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })} />}</Field>
        <Field label="1º vencimento">{(id) => <Input id={id} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>
        <Field label={kind === "receivable" ? "Cliente" : "Fornecedor"}>
          {(id) => (
            <Select id={id} value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Categoria" hint={kind === "receivable" && f.category === "Serviço" ? "Serviço avulso conta como receita na competência." : undefined}>
          {(id) => (
            <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {(kind === "receivable" ? ["Serviço", "Outros"] : ["Fornecedor", "Serviços", "Impostos", "Outros"]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
