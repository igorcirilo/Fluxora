"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, FileText, Receipt, RotateCcw, ScanLine } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { useAction } from "@/components/use-action";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, SearchInput, Segmented, cn } from "@/components/ui";
import { formatBRL } from "@/modules/finance/money";
import { addDays, compareBiz, formatBizDate, todayBiz } from "@/modules/finance/dates";
import { PAYMENT_LABEL, type Sale } from "@/modules/sales/types";
import { FISCAL_DOC_LABEL, FISCAL_STATUS_LABEL } from "@/modules/fiscal/provider";
import { downloadCsv } from "@/components/csv";

type Range = "hoje" | "7d" | "30d" | "todas";

export function SalesView() {
  const t = useTenant();
  const act = useAction();
  const [range, setRange] = useState<Range>("7d");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const today = todayBiz();

  const list = useMemo(() => {
    if (!t) return [];
    const from = range === "hoje" ? today : range === "7d" ? addDays(today, -6) : range === "30d" ? addDays(today, -29) : "0000-01-01";
    const customers = new Map(t.state.customers.map((c) => [c.id, c.name.toLowerCase()]));
    const term = q.trim().toLowerCase().replace("#", "");
    return t.state.sales
      .filter((s) => compareBiz(s.date, from) >= 0)
      .filter((s) => !term || String(s.number) === term || s.items.some((i) => i.name.toLowerCase().includes(term)) || (s.customerId && customers.get(s.customerId)?.includes(term)))
      .sort((a, b) => b.number - a.number);
  }, [t, range, q, today]);

  if (!t) return null;
  const sale = openId ? (t.state.sales.find((s) => s.id === openId) ?? null) : null;
  const totalPeriod = list.filter((s) => s.status === "concluida").reduce((s, x) => s + x.totalCents, 0);
  const customerName = (id?: string) => (id ? t.state.customers.find((c) => c.id === id)?.name : undefined);

  const exportCsv = () =>
    downloadCsv(`vendas-${today}.csv`, [
      ["numero", "data", "status", "cliente", "itens", "subtotal", "desconto", "total", "pagamentos"],
      ...list.map((s) => [
        s.number,
        s.date,
        s.status,
        customerName(s.customerId) ?? "",
        s.items.map((i) => `${i.quantity}x ${i.name}`).join(" | "),
        (s.subtotalCents / 100).toFixed(2),
        (s.discountCents / 100).toFixed(2),
        (s.totalCents / 100).toFixed(2),
        s.payments.map((p) => `${p.method}:${(p.amountCents / 100).toFixed(2)}`).join(" | "),
      ]),
    ]);

  return (
    <div className="animate-in">
      <PageHeader
        title="Vendas"
        description="Histórico, devoluções, comprovantes e rascunhos fiscais."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!list.length}>
              <Download size={16} /> CSV
            </Button>
            <Link href="/pdv">
              <Button>
                <ScanLine size={16} /> Nova venda
              </Button>
            </Link>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="flex-1" value={q} onChange={setQ} placeholder="Buscar nº, produto ou cliente" />
        <Segmented
          value={range}
          onChange={(v) => {
            setRange(v);
            setLimit(30);
          }}
          options={[
            { value: "hoje", label: "Hoje" },
            { value: "7d", label: "7 dias" },
            { value: "30d", label: "30 dias" },
            { value: "todas", label: "Todas" },
          ]}
        />
      </div>
      <div className="mb-3 flex items-baseline justify-between text-[13px] text-muted">
        <span>{list.length} venda(s)</span>
        <span>
          Total concluído: <b className="text-fg tabular">{formatBRL(totalPeriod)}</b>
        </span>
      </div>

      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Receipt size={24} />}
            title="Nenhuma venda encontrada"
            description={t.state.sales.length ? "Ajuste o período ou a busca." : "Registre a primeira venda no PDV."}
            action={
              !t.state.sales.length ? (
                <Link href="/pdv">
                  <Button>Abrir PDV</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.slice(0, limit).map((s) => (
              <li key={s.id}>
                <button onClick={() => setOpenId(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 sm:px-5">
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[12px] font-semibold tabular",
                      s.status === "devolvida" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
                    )}
                  >
                    #{s.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{s.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                      {formatBizDate(s.date)}
                      <span>·</span>
                      {s.payments.map((p) => PAYMENT_LABEL[p.method]).join(" + ")}
                      {customerName(s.customerId) ? <span className="hidden truncate sm:inline">· {customerName(s.customerId)}</span> : null}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cn("block text-[14px] font-semibold tabular", s.status === "devolvida" && "text-subtle line-through")}>{formatBRL(s.totalCents)}</span>
                    {s.status === "devolvida" ? <Badge tone="danger">Devolvida</Badge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.length > limit ? (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 30)}>
              Carregar mais ({list.length - limit} restantes)
            </Button>
          </div>
        ) : null}
      </Card>

      {sale ? (
        <SaleDetail
          sale={sale}
          serviceOnly={sale.items.every((i) => !t.state.products.find((p) => p.id === i.productId)?.trackStock)}
          customer={customerName(sale.customerId)}
          fiscal={t.state.fiscalDocuments.find((d) => d.saleId === sale.id && d.status !== "cancelled")}
          onClose={() => setOpenId(null)}
          onReturn={() => setConfirmReturn(true)}
          onDraft={(type) => void act("fiscal.draft", { saleId: sale.id, type }, "Rascunho fiscal criado. O envio depende de provedor homologado.")}
        />
      ) : null}

      <Modal
        open={confirmReturn && !!sale}
        onClose={() => setConfirmReturn(false)}
        title="Confirmar devolução?"
        size="sm"
        description="O histórico é preservado: geramos estorno ligado à venda, devolução ao estoque e reembolso dos valores recebidos."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReturn(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const r = await act("sale.return", { saleId: sale!.id }, "Devolução registrada.");
                if (r.ok) setConfirmReturn(false);
              }}
            >
              <RotateCcw size={16} /> Devolver venda
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">
          Venda #{sale?.number} · {sale ? formatBRL(sale.totalCents) : ""}. Pagamentos em dinheiro exigem o caixa aberto para o reembolso.
        </p>
      </Modal>
    </div>
  );
}

function SaleDetail({
  sale,
  serviceOnly,
  customer,
  fiscal,
  onClose,
  onReturn,
  onDraft,
}: {
  sale: Sale;
  serviceOnly: boolean;
  customer?: string;
  fiscal?: { type: "nfse" | "nfce" | "nfe"; status: keyof typeof FISCAL_STATUS_LABEL };
  onClose: () => void;
  onReturn: () => void;
  onDraft: (t: "nfse" | "nfce") => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Venda #${sale.number}`}
      description={`${formatBizDate(sale.date)}${customer ? ` · ${customer}` : ""}`}
      footer={
        sale.status === "concluida" ? (
          <>
            {!fiscal ? (
              <Button variant="outline" onClick={() => onDraft(serviceOnly ? "nfse" : "nfce")}>
                <FileText size={16} /> Rascunho fiscal
              </Button>
            ) : null}
            <Button variant="danger" onClick={onReturn}>
              <RotateCcw size={16} /> Devolver
            </Button>
          </>
        ) : undefined
      }
    >
      {sale.status === "devolvida" ? <Badge tone="danger">Devolvida</Badge> : <Badge tone="success">Concluída</Badge>}
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {sale.items.map((i) => (
          <li key={i.productId} className="flex justify-between gap-3 px-3 py-2.5 text-[13.5px]">
            <span className="min-w-0 truncate">
              {i.quantity}× {i.name}
            </span>
            <span className="shrink-0 tabular">{formatBRL(i.totalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 text-[13.5px]">
        <Row k="Subtotal" v={formatBRL(sale.subtotalCents)} />
        {sale.discountCents ? <Row k="Desconto" v={`−${formatBRL(sale.discountCents)}`} /> : null}
        <Row k="Total" v={formatBRL(sale.totalCents)} bold />
        {sale.payments.map((p, i) => (
          <Row key={i} k={PAYMENT_LABEL[p.method]} v={formatBRL(p.amountCents)} muted />
        ))}
        {sale.changeCents ? <Row k="Troco" v={formatBRL(sale.changeCents)} muted /> : null}
      </dl>
      <div className="mt-4 rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted">
        {fiscal ? (
          <>
            Documento fiscal: <b className="text-fg">{FISCAL_DOC_LABEL[fiscal.type]}</b> — {FISCAL_STATUS_LABEL[fiscal.status]}. Envio indisponível sem provedor homologado.
          </>
        ) : (
          <>Sem documento fiscal. O comprovante da venda não substitui nota fiscal.</>
        )}
      </div>
    </Modal>
  );
}

function Row({ k, v, bold, muted }: { k: string; v: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-muted", bold && "text-[15px] font-semibold")}>
      <dt>{k}</dt>
      <dd className="tabular">{v}</dd>
    </div>
  );
}
