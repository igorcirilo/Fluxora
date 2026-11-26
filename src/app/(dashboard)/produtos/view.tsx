"use client";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Boxes, Download, PackagePlus, Pencil, Upload, History, ArrowDownUp } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { safeParse, useAction } from "@/components/use-action";
import { ProductAvatar } from "@/components/product-avatar";
import { downloadCsv } from "@/components/csv";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, SearchInput, Segmented, Select, Switch, Textarea, cn } from "@/components/ui";
import { centsToInput, formatBRL, parseCents } from "@/modules/finance/money";
import { formatBizDate, todayBiz } from "@/modules/finance/dates";
import { STOCK_MOVEMENT_LABEL, stockBalances, type Product } from "@/modules/inventory/stock";
import { createProduct, moveStock, updateProduct } from "@/modules/inventory/ops";
import type { TenantState } from "@/modules/tenants/state";

type Filter = "todos" | "baixo" | "servicos" | "inativos";

export function ProductsView() {
  const t = useTenant();
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>((params.get("filtro") as Filter) === "baixo" ? "baixo" : "todos");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [moving, setMoving] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const balances = useMemo(() => (t ? stockBalances(t.state.stockMovements) : new Map<string, number>()), [t]);
  if (!t) return null;
  const term = q.trim().toLowerCase();
  const list = t.state.products
    .filter((p) => (filter === "inativos" ? !p.active : p.active))
    .filter((p) => filter !== "servicos" || !p.trackStock)
    .filter((p) => filter !== "baixo" || (p.trackStock && (balances.get(p.id) ?? 0) <= p.minStock))
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcode?.includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const stockValue = t.state.products.filter((p) => p.trackStock && p.active).reduce((s, p) => s + Math.max(0, balances.get(p.id) ?? 0) * p.costCents, 0);
  const lowCount = t.state.products.filter((p) => p.active && p.trackStock && (balances.get(p.id) ?? 0) <= p.minStock).length;

  return (
    <div className="animate-in">
      <PageHeader
        title="Produtos e estoque"
        description="Cadastro, preços, custos e movimentações auditadas."
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Importar
            </Button>
            <Button
              variant="outline"
              disabled={!t.state.products.length}
              onClick={() =>
                downloadCsv(`produtos-${todayBiz()}.csv`, [
                  ["nome", "sku", "codigo_barras", "categoria", "preco", "custo", "estoque", "estoque_minimo", "controla_estoque", "ativo"],
                  ...t.state.products.map((p) => [
                    p.name,
                    p.sku,
                    p.barcode ?? "",
                    p.category,
                    centsToInput(p.priceCents),
                    centsToInput(p.costCents),
                    p.trackStock ? (balances.get(p.id) ?? 0) : "",
                    p.minStock,
                    p.trackStock ? "sim" : "nao",
                    p.active ? "sim" : "nao",
                  ]),
                ])
              }
            >
              <Download size={16} /> CSV
            </Button>
            <Button onClick={() => setEditing("new")}>
              <PackagePlus size={16} /> Novo produto
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Itens ativos" value={String(t.state.products.filter((p) => p.active).length)} />
        <Stat label="Estoque baixo" value={String(lowCount)} tone={lowCount ? "warn" : undefined} />
        <div className="col-span-2 sm:col-span-1">
          <Stat label="Valor em estoque (custo)" value={formatBRL(stockValue)} />
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="flex-1" value={q} onChange={setQ} placeholder="Buscar por nome, SKU ou código" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todos", label: "Todos" },
            { value: "baixo", label: "Estoque baixo" },
            { value: "servicos", label: "Serviços" },
            { value: "inativos", label: "Inativos" },
          ]}
        />
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Boxes size={24} />}
            title={t.state.products.length ? "Nada neste filtro" : "Nenhum produto ainda"}
            description={t.state.products.length ? "Tente outro filtro ou busca." : "Cadastre produtos ou serviços para vender no PDV."}
            action={!t.state.products.length ? <Button onClick={() => setEditing("new")}>Cadastrar primeiro produto</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((p) => {
              const bal = balances.get(p.id) ?? 0;
              const low = p.trackStock && bal <= p.minStock;
              const margin = p.priceCents > 0 ? Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100) : 0;
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <ProductAvatar name={p.name} category={p.category} />
                  <div className="min-w-0 flex-1">
                    <button className="line-clamp-2 text-left text-[14px] leading-snug font-medium hover:text-brand" onClick={() => setEditing(p)}>
                      {p.name}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                      <span className="font-mono">{p.sku}</span>
                      <span>· {p.category}</span>
                      <span className="hidden sm:inline">· margem {margin}%</span>
                    </div>
                  </div>
                  <div className="hidden w-28 text-right sm:block">
                    {p.trackStock ? (
                      <Badge tone={bal <= 0 ? "danger" : low ? "warn" : "neutral"}>
                        {bal} {p.unit}
                      </Badge>
                    ) : (
                      <Badge tone="info">Serviço</Badge>
                    )}
                  </div>
                  <div className="w-24 text-right">
                    <div className="text-[14px] font-semibold tabular">{formatBRL(p.priceCents)}</div>
                    <div className="text-[11.5px] text-subtle sm:hidden">
                      {p.trackStock ? (
                        <span className={cn(low && "text-warn")}>
                          {bal} {p.unit}
                        </span>
                      ) : (
                        "serviço"
                      )}
                    </div>
                  </div>
                  <div className="flex">
                    {p.trackStock ? (
                      <Button variant="ghost" size="icon" aria-label={`Movimentar estoque de ${p.name}`} onClick={() => setMoving(p)}>
                        <ArrowDownUp size={16} />
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
                      <Pencil size={16} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing ? <ProductForm product={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {moving ? <StockModal product={moving} balance={balances.get(moving.id) ?? 0} state={t.state} onClose={() => setMoving(null)} /> : null}
      {importOpen ? <ImportModal onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-[11.5px] text-muted sm:text-[12.5px]">{label}</div>
      <div className={cn("mt-1 truncate text-[16px] font-semibold tabular sm:text-[19px]", tone === "warn" && "text-warn")}>{value}</div>
    </Card>
  );
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? "",
    unit: product?.unit ?? ("un" as Product["unit"]),
    price: product ? centsToInput(product.priceCents) : "",
    cost: product ? centsToInput(product.costCents) : "",
    minStock: String(product?.minStock ?? 0),
    trackStock: product?.trackStock ?? true,
    active: product?.active ?? true,
    initialStock: "0",
  });
  const price = safeParse(() => parseCents(f.price));
  const cost = f.cost ? safeParse(() => parseCents(f.cost, { allowZero: true })) : 0;
  const margin = price && cost !== null ? Math.round(((price - cost) / price) * 100) : null;
  const submit = () => {
    if (price === null || cost === null) return;
    const base = {
      name: f.name,
      sku: f.sku,
      barcode: f.barcode.trim() || undefined,
      category: f.category,
      unit: f.unit,
      priceCents: price,
      costCents: cost,
      minStock: Number(f.minStock) || 0,
      trackStock: f.trackStock,
    };
    const r = product
      ? act((s, c) => updateProduct(s, product.id, { ...base, active: f.active }, c), "Produto atualizado.")
      : act((s, c) => createProduct(s, { ...base, initialStock: Number(f.initialStock) || 0 }, c), "Produto cadastrado.");
    if (r.ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={product ? "Editar produto" : "Novo produto"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!f.name.trim() || price === null || cost === null}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2">
          {(id) => <Input id={id} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Bolo de pote" />}
        </Field>
        <Field label="SKU" hint="Letras, números e hífen.">
          {(id) => <Input id={id} value={f.sku} maxLength={30} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} placeholder="BOLO-01" />}
        </Field>
        <Field label="Código de barras (opcional)">
          {(id) => <Input id={id} inputMode="numeric" value={f.barcode} maxLength={14} onChange={(e) => setF({ ...f, barcode: e.target.value.replace(/\D/g, "") })} />}
        </Field>
        <Field label="Categoria">{(id) => <Input id={id} value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Doces" />}</Field>
        <Field label="Unidade">
          {(id) => (
            <Select id={id} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Product["unit"] })}>
              <option value="un">Unidade</option>
              <option value="cx">Caixa</option>
              <option value="pct">Pacote</option>
              <option value="kg">Quilo (inteiro)</option>
              <option value="h">Hora / serviço</option>
            </Select>
          )}
        </Field>
        <Field label="Preço de venda" error={f.price && price === null ? "Valor inválido." : null}>
          {(id) => <MoneyInput id={id} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}
        </Field>
        <Field label="Custo unitário" hint={margin !== null ? `Margem bruta estimada: ${margin}%` : "Usado na margem estimada."}>
          {(id) => <MoneyInput id={id} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}
        </Field>
        <div className="space-y-4 rounded-2xl border border-line p-4 sm:col-span-2">
          <Switch checked={f.trackStock} onChange={(v) => setF({ ...f, trackStock: v })} label="Controlar estoque" description="Desative para serviços." />
          {f.trackStock ? (
            <div className="grid grid-cols-2 gap-3">
              {!product ? (
                <Field label="Estoque inicial">{(id) => <Input id={id} type="number" min={0} value={f.initialStock} onChange={(e) => setF({ ...f, initialStock: e.target.value })} />}</Field>
              ) : null}
              <Field label="Estoque mínimo">{(id) => <Input id={id} type="number" min={0} value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} />}</Field>
            </div>
          ) : null}
          {product ? <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Ativo" description="Inativos não aparecem no PDV; o histórico é mantido." /> : null}
        </div>
      </div>
    </Modal>
  );
}

function StockModal({ product, balance, state, onClose }: { product: Product; balance: number; state: TenantState; onClose: () => void }) {
  const act = useAction();
  const [type, setType] = useState<"purchase" | "loss" | "adjustment">("purchase");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const n = Number(qty);
  const valid = Number.isInteger(n) && (type === "adjustment" ? n >= 0 && qty !== "" : n > 0);
  const history = state.stockMovements
    .filter((m) => m.productId === product.id)
    .slice(-12)
    .reverse();
  return (
    <Modal
      open
      onClose={onClose}
      title={`Estoque · ${product.name}`}
      description={`Saldo atual: ${balance} ${product.unit}. Movimentos são imutáveis e auditados.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              const r = act(
                (s, c) => moveStock(s, { productId: product.id, type, quantity: n, countedTo: type === "adjustment" ? n : undefined, note: note.trim() || undefined }, c),
                "Movimento registrado.",
              );
              if (r.ok) {
                setQty("");
                setNote("");
              }
            }}
          >
            Registrar
          </Button>
        </>
      }
    >
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: "purchase", label: "Compra" },
          { value: "loss", label: "Perda" },
          { value: "adjustment", label: "Inventário" },
        ]}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label={type === "adjustment" ? "Quantidade contada" : "Quantidade"}
          hint={type === "adjustment" && qty !== "" && valid ? `Ajuste de ${n - balance >= 0 ? "+" : ""}${n - balance}` : undefined}
        >
          {(id) => <Input id={id} type="number" min={0} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />}
        </Field>
        <Field label="Motivo / observação">
          {(id) => <Input id={id} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={type === "loss" ? "Ex.: validade vencida" : ""} />}
        </Field>
      </div>
      <h3 className="mt-5 mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <History size={15} /> Últimos movimentos
      </h3>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {history.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0">
              <span className="block">{STOCK_MOVEMENT_LABEL[m.type]}</span>
              <span className="block truncate text-[11.5px] text-subtle">
                {formatBizDate(m.date)}
                {m.note ? ` · ${m.note}` : ""}
              </span>
            </span>
            <span className={cn("font-semibold tabular", m.quantity > 0 ? "text-accent" : "text-danger")}>
              {m.quantity > 0 ? "+" : ""}
              {m.quantity}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const [text, setText] = useState("nome;sku;categoria;preco;custo;estoque\nPão de mel;PMEL-01;Doces;6,50;2,10;40");
  const [report, setReport] = useState<string[] | null>(null);
  const run = () => {
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.split(";").map((c) => c.trim()))
      .filter((r) => r.some(Boolean));
    const [, ...data] = rows;
    const msgs: string[] = [];
    let ok = 0;
    data.forEach((r, i) => {
      const [name = "", sku = "", category = "", price = "", cost = "", stock = ""] = r;
      const priceCents = safeParse(() => parseCents(price));
      const costCents = cost ? safeParse(() => parseCents(cost, { allowZero: true })) : 0;
      if (priceCents === null || costCents === null) return msgs.push(`Linha ${i + 2}: preço/custo inválido.`);
      const qty = Number(stock || 0);
      const res = act((s, c) =>
        createProduct(s, { name, sku, category, unit: "un", priceCents, costCents, minStock: 0, trackStock: stock !== "", initialStock: Number.isInteger(qty) && qty > 0 ? qty : 0 }, c),
      );
      if (res.ok) ok += 1;
      else msgs.push(`Linha ${i + 2}: ${res.message}`);
    });
    setReport([`${ok} produto(s) importado(s).`, ...msgs]);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Importar produtos (CSV)"
      description="Cole linhas separadas por ponto e vírgula. Cada linha é validada individualmente."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={run}>
            <Upload size={16} /> Importar
          </Button>
        </>
      }
    >
      <Textarea aria-label="Conteúdo CSV" className="min-h-40 font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mt-2 text-[12px] text-muted">Colunas: nome; sku; categoria; preço; custo; estoque (vazio = serviço). Importação de XML de NF-e de compra fica para a próxima etapa.</p>
      {report ? (
        <ul className="mt-3 space-y-1 rounded-xl bg-surface-2 p-3 text-[12.5px]">
          {report.map((m, i) => (
            <li key={i} className={i === 0 ? "font-medium text-accent" : "text-danger"}>
              {m}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
