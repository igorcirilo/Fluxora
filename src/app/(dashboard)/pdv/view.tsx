"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  Banknote,
  CreditCard,
  Landmark,
  Lock,
  Minus,
  Plus,
  Printer,
  QrCode,
  ShoppingBag,
  Trash2,
  Unlock,
  UserRound,
  Wallet,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  MessageCircle,
  CheckCircle2,
  HandCoins,
} from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { newKey, safeParse, useAction } from "@/components/use-action";
import { ProductAvatar } from "@/components/product-avatar";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, MoneyInput, SearchInput, Segmented, Select, cn } from "@/components/ui";
import { formatBRL, parseCents, centsToInput } from "@/modules/finance/money";
import { addDays, formatBizDate, todayBiz } from "@/modules/finance/dates";
import { stockBalances } from "@/modules/inventory/stock";
import { checkout, openCashSession } from "@/modules/sales/checkout";
import { closeSession, drawerTransfer, expectedDrawer, openSession } from "@/modules/sales/cash-session";
import { PAYMENT_LABEL, type PaymentMethod, type Sale } from "@/modules/sales/types";
import { whatsappLink } from "@/modules/customers/customer";
import type { Product } from "@/modules/inventory/stock";

interface CartLine {
  productId: string;
  quantity: number;
}

const METHOD_ICON: Record<PaymentMethod, React.ReactNode> = {
  dinheiro: <Banknote size={18} />,
  pix: <QrCode size={18} />,
  debito: <CreditCard size={18} />,
  credito: <Landmark size={18} />,
  fiado: <HandCoins size={18} />,
};

export function PosView() {
  const t = useTenant();
  const act = useAction();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("Todos");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountText, setDiscountText] = useState("");
  const [discountMode, setDiscountMode] = useState<"valor" | "pct">("valor");
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [sessionModal, setSessionModal] = useState<null | "abrir" | "fechar" | "sangria" | "suprimento">(null);
  const idemKey = useRef<string>(newKey());
  const searchRef = useRef<HTMLInputElement>(null);

  const balances = useMemo(() => (t ? stockBalances(t.state.stockMovements) : new Map<string, number>()), [t]);
  if (!t) return null;
  const { state } = t;
  const session = openCashSession(state);
  const products = state.products.filter((p) => p.active);
  const categories = ["Todos", ...Array.from(new Set(products.map((p) => p.category)))];
  const q = query.trim().toLowerCase();
  const visible = products.filter((p) => (cat === "Todos" || p.category === cat) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.includes(q)));

  const lines = cart.map((l) => ({ ...l, product: state.products.find((p) => p.id === l.productId)! })).filter((l) => l.product);
  const subtotal = lines.reduce((s, l) => s + l.product.priceCents * l.quantity, 0);
  const discountParsed = discountText ? safeParse(() => parseCents(discountText, { allowZero: true })) : 0;
  const discount = discountParsed === null ? 0 : discountMode === "pct" ? Math.floor((subtotal * Math.min(discountParsed, 10000)) / 10000) : discountParsed;
  const discountInvalid = discountParsed === null || (discount >= subtotal && subtotal > 0);
  const total = Math.max(0, subtotal - (discountInvalid ? 0 : discount));
  const count = lines.reduce((s, l) => s + l.quantity, 0);

  const available = (p: Product) => (p.trackStock ? (balances.get(p.id) ?? 0) - (cart.find((c) => c.productId === p.id)?.quantity ?? 0) : Infinity);
  const add = (p: Product) => {
    if (p.trackStock && !state.tenant.allowNegativeStock && available(p) <= 0) return;
    setCart((c) => (c.some((x) => x.productId === p.id) ? c.map((x) => (x.productId === p.id ? { ...x, quantity: x.quantity + 1 } : x)) : [...c, { productId: p.id, quantity: 1 }]));
  };
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? c.filter((x) => x.productId !== id) : c.map((x) => (x.productId === id ? { ...x, quantity: qty } : x))));
  const clear = () => {
    setCart([]);
    setDiscountText("");
    idemKey.current = newKey();
  };

  const onScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = query.trim().toUpperCase();
    const p = products.find((x) => x.barcode === code || x.sku === code);
    if (p) {
      add(p);
      setQuery("");
    }
  };

  const cartPanel = (
    <CartPanel
      lines={lines}
      setQty={setQty}
      clear={clear}
      subtotal={subtotal}
      discountText={discountText}
      setDiscountText={setDiscountText}
      discountMode={discountMode}
      setDiscountMode={setDiscountMode}
      discountInvalid={discountInvalid}
      discount={discountInvalid ? 0 : discount}
      total={total}
      onPay={() => {
        setCartOpen(false);
        setPayOpen(true);
      }}
    />
  );

  return (
    <div className="animate-in">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">Ponto de venda</h1>
          <p className="mt-0.5 text-[13px] text-muted">Toque nos itens ou leia o código de barras/SKU e pressione Enter.</p>
        </div>
        <SessionBar session={session ? { openedAt: session.openedAt, drawer: expectedDrawer(state, session.id) } : null} onAction={setSessionModal} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <SearchInput inputRef={searchRef} value={query} onChange={setQuery} onKeyDown={onScan} placeholder="Buscar produto, SKU ou código de barras" />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition",
                  c === cat ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted hover:text-fg",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {products.length === 0 ? (
            <Card className="mt-4">
              <EmptyState
                icon={<ShoppingBag size={24} />}
                title="Nenhum produto cadastrado"
                description="Cadastre produtos ou serviços para começar a vender."
                action={
                  <Link href="/produtos">
                    <Button>Cadastrar produto</Button>
                  </Link>
                }
              />
            </Card>
          ) : visible.length === 0 ? (
            <p className="mt-8 text-center text-[13.5px] text-muted">Nada encontrado para “{query}”.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((p) => {
                const inCart = cart.find((c) => c.productId === p.id)?.quantity ?? 0;
                const avail = available(p);
                const blocked = p.trackStock && !state.tenant.allowNegativeStock && avail <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    disabled={blocked}
                    aria-label={`Adicionar ${p.name}`}
                    className={cn(
                      "relative flex flex-col items-start rounded-2xl border bg-surface p-3 text-left shadow-card transition active:scale-[0.98] disabled:opacity-50",
                      inCart ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-brand/40",
                    )}
                  >
                    {inCart ? <span className="absolute top-2 right-2 grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-[12px] font-semibold text-white">{inCart}</span> : null}
                    <ProductAvatar name={p.name} category={p.category} />
                    <span className="mt-2.5 line-clamp-2 min-h-[2.5em] text-[13.5px] leading-tight font-medium">{p.name}</span>
                    <span className="mt-1.5 text-[15px] font-semibold tabular">{formatBRL(p.priceCents)}</span>
                    <span className={cn("mt-0.5 text-[11.5px]", blocked ? "text-danger" : p.trackStock && avail <= p.minStock ? "text-warn" : "text-subtle")}>
                      {p.trackStock ? (blocked ? "Sem estoque" : `${avail} em estoque`) : "Serviço / sem estoque"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden lg:block">
          <Card className="sticky top-6 flex max-h-[calc(100dvh-48px)] flex-col">{cartPanel}</Card>
        </div>
      </div>

      {count > 0 ? (
        <div className="fixed inset-x-3 bottom-[76px] z-30 lg:hidden">
          <button onClick={() => setCartOpen(true)} className="animate-in flex w-full items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-white shadow-[0_12px_30px_-10px_var(--brand)]">
            <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-white/20 px-1.5 text-[13px] font-semibold">{count}</span>
            <span className="flex-1 text-left text-[14px] font-medium">Ver carrinho</span>
            <span className="text-[16px] font-semibold tabular">{formatBRL(total)}</span>
          </button>
        </div>
      ) : null}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Carrinho" description={`${count} ${count === 1 ? "item" : "itens"}`}>
        <div className="-mx-5 -mb-5">{cartPanel}</div>
      </Modal>

      {payOpen ? (
        <PaymentModal
          total={total}
          customers={state.customers}
          hasSession={!!session}
          onClose={() => setPayOpen(false)}
          onConfirm={(p) => {
            const r = act((s, c) => {
              const out = checkout(
                s,
                { idempotencyKey: idemKey.current, items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })), discountCents: discountInvalid ? 0 : discount, ...p },
                c,
              );
              return { state: out.state, value: out.sale };
            });
            if (r.ok) {
              setPayOpen(false);
              setReceipt(r.value);
              clear();
            }
          }}
        />
      ) : null}

      {receipt ? (
        <ReceiptModal
          sale={receipt}
          onClose={() => {
            setReceipt(null);
            searchRef.current?.focus();
          }}
        />
      ) : null}

      <SessionModal
        mode={sessionModal}
        expected={session ? expectedDrawer(state, session.id) : 0}
        onClose={() => setSessionModal(null)}
        onSubmit={(mode, cents, note) => {
          const r =
            mode === "abrir"
              ? act((s, c) => openSession(s, cents, c), "Caixa aberto.")
              : mode === "fechar"
                ? act((s, c) => closeSession(s, cents, c), "Caixa fechado.")
                : act((s, c) => drawerTransfer(s, mode, cents, c, note), mode === "sangria" ? "Sangria registrada." : "Suprimento registrado.");
          if (r.ok) setSessionModal(null);
        }}
      />
    </div>
  );
}

function SessionBar({ session, onAction }: { session: { openedAt: string; drawer: number } | null; onAction: (m: "abrir" | "fechar" | "sangria" | "suprimento") => void }) {
  if (!session)
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3">
        <Lock size={15} className="text-muted" />
        <span className="text-[13px] text-muted">Caixa fechado</span>
        <Button size="sm" onClick={() => onAction("abrir")}>
          <Unlock size={14} /> Abrir caixa
        </Button>
      </div>
    );
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(session.openedAt));
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface p-1.5 pl-3">
      <span className="mr-1 flex items-center gap-2 text-[13px]">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_0_3px_var(--accent-soft)]" />
        <span className="text-muted">Aberto {time} · gaveta</span>
        <b className="tabular">{formatBRL(session.drawer)}</b>
      </span>
      <Button size="sm" variant="secondary" onClick={() => onAction("sangria")} title="Retirar dinheiro da gaveta">
        <ArrowUpFromLine size={14} /> Sangria
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onAction("suprimento")} title="Colocar troco na gaveta">
        <ArrowDownToLine size={14} /> Suprimento
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAction("fechar")}>
        <Lock size={14} /> Fechar
      </Button>
    </div>
  );
}

function CartPanel(props: {
  lines: { productId: string; quantity: number; product: Product }[];
  setQty: (id: string, q: number) => void;
  clear: () => void;
  subtotal: number;
  discountText: string;
  setDiscountText: (v: string) => void;
  discountMode: "valor" | "pct";
  setDiscountMode: (v: "valor" | "pct") => void;
  discountInvalid: boolean;
  discount: number;
  total: number;
  onPay: () => void;
}) {
  const { lines } = props;
  return (
    <>
      <div className="hidden items-center justify-between border-b border-line px-4 py-3 lg:flex">
        <span className="text-[15px] font-semibold">Carrinho</span>
        {lines.length ? (
          <button onClick={props.clear} className="text-[12.5px] font-medium text-muted hover:text-danger">
            Limpar
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {lines.length === 0 ? (
          <EmptyState className="py-10" icon={<ShoppingBag size={22} />} title="Carrinho vazio" description="Toque em um produto para adicionar." />
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 py-3">
                <ProductAvatar name={l.product.name} category={l.product.category} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{l.product.name}</div>
                  <div className="text-[12px] text-muted tabular">{formatBRL(l.product.priceCents)} un.</div>
                </div>
                <div className="flex items-center rounded-xl border border-line">
                  <button className="grid h-8 w-8 place-items-center text-muted hover:text-fg" onClick={() => props.setQty(l.productId, l.quantity - 1)} aria-label={`Diminuir ${l.product.name}`}>
                    {l.quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                  </button>
                  <span className="w-7 text-center text-[13.5px] font-semibold tabular">{l.quantity}</span>
                  <button className="grid h-8 w-8 place-items-center text-muted hover:text-fg" onClick={() => props.setQty(l.productId, l.quantity + 1)} aria-label={`Aumentar ${l.product.name}`}>
                    <Plus size={14} />
                  </button>
                </div>
                <div className="w-20 text-right text-[13.5px] font-semibold tabular">{formatBRL(l.product.priceCents * l.quantity)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3 border-t border-line p-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            {props.discountMode === "valor" ? (
              <MoneyInput aria-label="Desconto em reais" placeholder="Desconto" value={props.discountText} onChange={(e) => props.setDiscountText(e.target.value)} />
            ) : (
              <div className="relative">
                <Input
                  aria-label="Desconto em percentual"
                  inputMode="decimal"
                  placeholder="Desconto"
                  value={props.discountText}
                  onChange={(e) => props.setDiscountText(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle">%</span>
              </div>
            )}
          </div>
          <Segmented
            size="sm"
            value={props.discountMode}
            onChange={(v) => {
              props.setDiscountMode(v);
              props.setDiscountText("");
            }}
            options={[
              { value: "valor", label: "R$" },
              { value: "pct", label: "%" },
            ]}
          />
        </div>
        {props.discountInvalid && props.discountText ? <p className="text-[12px] text-danger">Desconto inválido ou maior que o subtotal.</p> : null}
        <dl className="space-y-1 text-[13.5px]">
          <div className="flex justify-between text-muted">
            <dt>Subtotal</dt>
            <dd className="tabular">{formatBRL(props.subtotal)}</dd>
          </div>
          {props.discount > 0 ? (
            <div className="flex justify-between text-accent">
              <dt>Desconto</dt>
              <dd className="tabular">−{formatBRL(props.discount)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between pt-1">
            <dt className="font-medium">Total</dt>
            <dd className="text-[24px] font-semibold tracking-tight tabular">{formatBRL(props.total)}</dd>
          </div>
        </dl>
        <Button size="lg" className="w-full" disabled={!lines.length || props.total <= 0} onClick={props.onPay}>
          Cobrar {formatBRL(props.total)}
        </Button>
      </div>
    </>
  );
}

interface PayLine {
  method: PaymentMethod;
  text: string;
}

function PaymentModal({
  total,
  customers,
  hasSession,
  onClose,
  onConfirm,
}: {
  total: number;
  customers: { id: string; name: string }[];
  hasSession: boolean;
  onClose: () => void;
  onConfirm: (p: { payments: { method: PaymentMethod; amountCents: number }[]; cashTenderedCents?: number; customerId?: string; creditDueDate?: string }) => void;
}) {
  const [lines, setLines] = useState<PayLine[]>([{ method: "pix", text: centsToInput(total) }]);
  const [tendered, setTendered] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [due, setDue] = useState(addDays(todayBiz(), 30));
  const [busy, setBusy] = useState(false);
  const parsed = lines.map((l) => ({ method: l.method, amountCents: safeParse(() => parseCents(l.text)) }));
  const valid = parsed.every((p) => p.amountCents !== null);
  const paid = parsed.reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const remaining = total - paid;
  const cash = parsed.filter((p) => p.method === "dinheiro").reduce((s, p) => s + (p.amountCents ?? 0), 0);
  const tenderedCents = tendered ? safeParse(() => parseCents(tendered)) : null;
  const change = cash > 0 && tenderedCents !== null ? tenderedCents - cash : 0;
  const hasFiado = lines.some((l) => l.method === "fiado");
  const problems: string[] = [];
  if (!valid) problems.push("Valor inválido em um dos pagamentos.");
  if (valid && remaining !== 0) problems.push(remaining > 0 ? `Faltam ${formatBRL(remaining)}.` : `Pagamentos excedem o total em ${formatBRL(-remaining)}. Use “valor recebido” para troco.`);
  if (cash > 0 && !hasSession) problems.push("Abra o caixa para receber em dinheiro.");
  if (cash > 0 && tenderedCents !== null && tenderedCents < cash) problems.push("Valor recebido menor que o valor em dinheiro.");
  if (hasFiado && !customerId) problems.push("Selecione o cliente para venda fiado.");

  const setMethod = (i: number, m: PaymentMethod) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, method: m } : l)));
  const addLine = () => setLines((ls) => [...ls, { method: "dinheiro", text: remaining > 0 ? centsToInput(remaining) : "" }]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Pagamento"
      description="Pix e cartões são apenas registrados aqui: o Fluxora não processa pagamentos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Voltar
          </Button>
          <Button
            size="lg"
            disabled={problems.length > 0 || busy}
            loading={busy}
            onClick={() => {
              setBusy(true);
              onConfirm({
                payments: parsed.map((p) => ({ method: p.method, amountCents: p.amountCents! })),
                cashTenderedCents: cash > 0 ? (tenderedCents ?? cash) : undefined,
                customerId: customerId || undefined,
                creditDueDate: hasFiado ? due : undefined,
              });
              setBusy(false);
            }}
          >
            <CheckCircle2 size={18} /> Finalizar venda
          </Button>
        </>
      }
    >
      <div className="rounded-2xl bg-surface-2 p-4 text-center">
        <div className="text-[12.5px] text-muted">Total a pagar</div>
        <div className="text-[32px] font-semibold tracking-tight tabular">{formatBRL(total)}</div>
      </div>
      <div className="mt-4 space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="rounded-2xl border border-line p-3">
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(i, m)}
                  aria-pressed={l.method === m}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border py-2 text-[11px] font-medium transition",
                    l.method === m ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-fg",
                  )}
                >
                  {METHOD_ICON[m]}
                  {m === "fiado" ? "Fiado" : PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <MoneyInput aria-label={`Valor ${PAYMENT_LABEL[l.method]}`} value={l.text} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              {lines.length > 1 ? (
                <Button variant="ghost" size="icon" aria-label="Remover pagamento" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <X size={16} />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {remaining > 0 && valid ? (
          <Button variant="outline" className="w-full" onClick={addLine}>
            <Plus size={16} /> Dividir pagamento ({formatBRL(remaining)} restante)
          </Button>
        ) : null}

        {cash > 0 ? (
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line p-3">
            <Field label="Valor recebido em dinheiro">{(id) => <MoneyInput id={id} value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={centsToInput(cash)} />}</Field>
            <div className="flex flex-col justify-end rounded-xl bg-accent-soft p-3">
              <span className="text-[12px] text-accent">Troco</span>
              <span className="text-[20px] font-semibold text-accent tabular">{formatBRL(Math.max(0, change))}</span>
            </div>
          </div>
        ) : null}

        <div className={cn("grid gap-3", hasFiado && "sm:grid-cols-2")}>
          <Field label={hasFiado ? "Cliente (obrigatório no fiado)" : "Cliente (opcional)"}>
            {(id) => (
              <div className="relative">
                <UserRound size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
                <Select id={id} value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="pl-9">
                  <option value="">Consumidor não identificado</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </Field>
          {hasFiado ? <Field label="Vencimento do fiado">{(id) => <Input id={id} type="date" value={due} min={todayBiz()} onChange={(e) => setDue(e.target.value)} />}</Field> : null}
        </div>

        {problems.length ? (
          <ul className="space-y-1 rounded-xl bg-warn-soft p-3 text-[12.5px] text-warn">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-accent-soft p-3 text-[12.5px] text-accent">
            <CheckCircle2 size={15} /> Tudo certo. A venda, a baixa de estoque e o recebível são gravados juntos.
          </p>
        )}
      </div>
    </Modal>
  );
}

function ReceiptModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const t = useTenant();
  if (!t) return null;
  const customer = t.state.customers.find((c) => c.id === sale.customerId);
  const text = [
    `*${t.state.tenant.tradeName}* — Comprovante NÃO FISCAL`,
    `Venda #${sale.number} · ${formatBizDate(sale.date)}`,
    ...sale.items.map((i) => `${i.quantity}x ${i.name} — ${formatBRL(i.totalCents)}`),
    sale.discountCents ? `Desconto: −${formatBRL(sale.discountCents)}` : "",
    `*Total: ${formatBRL(sale.totalCents)}*`,
    "Obrigado pela preferência!",
  ]
    .filter(Boolean)
    .join("\n");
  const wa = customer?.phone ? whatsappLink(customer.phone, text) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Venda concluída"
      size="sm"
      footer={
        <>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full">
                <MessageCircle size={16} /> Enviar no WhatsApp
              </Button>
            </a>
          ) : null}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </Button>
          <Button onClick={onClose}>Nova venda</Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3 rounded-2xl bg-accent-soft p-3 text-accent">
        <CheckCircle2 size={22} />
        <div className="text-[13.5px]">
          <b>Venda #{sale.number} registrada.</b>
          {sale.changeCents > 0 ? (
            <>
              {" "}
              Troco: <b className="tabular">{formatBRL(sale.changeCents)}</b>
            </>
          ) : null}
        </div>
      </div>
      <div className="print-area rounded-2xl border border-dashed border-line-strong p-4 font-mono text-[12.5px]">
        <div className="text-center font-sans">
          <div className="text-[14px] font-semibold">{t.state.tenant.tradeName}</div>
          <div className="text-[11px] text-muted">{t.state.tenant.name}</div>
          <div className="mt-2 inline-block rounded-md bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">COMPROVANTE NÃO FISCAL</div>
        </div>
        <div className="my-3 border-t border-dashed border-line-strong" />
        <div className="flex justify-between">
          <span>Venda #{sale.number}</span>
          <span>{formatBizDate(sale.date)}</span>
        </div>
        {customer ? <div>Cliente: {customer.name}</div> : null}
        <div className="my-2 border-t border-dashed border-line-strong" />
        {sale.items.map((i) => (
          <div key={i.productId} className="flex justify-between gap-2">
            <span className="truncate">
              {i.quantity}x {i.name}
            </span>
            <span className="shrink-0">{formatBRL(i.totalCents)}</span>
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-line-strong" />
        {sale.discountCents ? (
          <div className="flex justify-between">
            <span>Desconto</span>
            <span>−{formatBRL(sale.discountCents)}</span>
          </div>
        ) : null}
        <div className="flex justify-between font-bold">
          <span>TOTAL</span>
          <span>{formatBRL(sale.totalCents)}</span>
        </div>
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between text-muted">
            <span>{PAYMENT_LABEL[p.method]}</span>
            <span>{formatBRL(p.amountCents)}</span>
          </div>
        ))}
        {sale.changeCents ? (
          <div className="flex justify-between text-muted">
            <span>Troco</span>
            <span>{formatBRL(sale.changeCents)}</span>
          </div>
        ) : null}
        <div className="mt-3 text-center font-sans text-[10.5px] text-muted">Este comprovante não substitui nota fiscal. Dados fictícios — demonstração.</div>
      </div>
      {sale.payments.some((p) => p.method === "credito" || p.method === "fiado") ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
          <Badge tone="info">A receber</Badge> Crédito/fiado entram no caixa só quando liquidados.
        </p>
      ) : null}
    </Modal>
  );
}

function SessionModal({
  mode,
  expected,
  onClose,
  onSubmit,
}: {
  mode: null | "abrir" | "fechar" | "sangria" | "suprimento";
  expected: number;
  onClose: () => void;
  onSubmit: (m: "abrir" | "fechar" | "sangria" | "suprimento", cents: number, note?: string) => void;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  if (!mode) return null;
  const allowZero = mode === "abrir" || mode === "fechar";
  const cents = value ? safeParse(() => parseCents(value, { allowZero })) : allowZero ? 0 : null;
  const titles = { abrir: "Abrir caixa", fechar: "Fechar caixa", sangria: "Sangria", suprimento: "Suprimento" };
  const descs = {
    abrir: "Conte o dinheiro na gaveta antes de começar.",
    fechar: "Conte o dinheiro na gaveta. A diferença fica registrada na auditoria.",
    sangria: "Retirada de dinheiro da gaveta para a conta PJ. Não é despesa.",
    suprimento: "Entrada de troco na gaveta vinda da conta PJ. Não é receita.",
  };
  const close = () => {
    setValue("");
    setNote("");
    onClose();
  };
  return (
    <Modal
      open
      onClose={close}
      title={titles[mode]}
      description={descs[mode]}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={cents === null}
            onClick={() => {
              onSubmit(mode, cents ?? 0, note);
              setValue("");
              setNote("");
            }}
          >
            <Wallet size={16} /> Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mode === "fechar" || mode === "sangria" ? (
          <div className="flex justify-between rounded-xl bg-surface-2 p-3 text-[13.5px]">
            <span className="text-muted">Esperado na gaveta</span>
            <b className="tabular">{formatBRL(expected)}</b>
          </div>
        ) : null}
        <Field label={mode === "fechar" || mode === "abrir" ? "Valor contado" : "Valor"} error={value && cents === null ? "Valor inválido." : null}>
          {(id) => <MoneyInput id={id} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        {mode === "fechar" && cents !== null ? (
          <div className={cn("flex justify-between rounded-xl p-3 text-[13.5px]", cents - expected === 0 ? "bg-accent-soft text-accent" : "bg-warn-soft text-warn")}>
            <span>Diferença</span>
            <b className="tabular">{formatBRL(cents - expected)}</b>
          </div>
        ) : null}
        {mode === "sangria" || mode === "suprimento" ? (
          <Field label="Observação (opcional)">{(id) => <Input id={id} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />}</Field>
        ) : null}
      </div>
    </Modal>
  );
}
