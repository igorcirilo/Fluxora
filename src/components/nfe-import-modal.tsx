"use client";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileCode2, FileUp, Link2, PackagePlus, Sparkles, TriangleAlert, Truck } from "lucide-react";
import { safeParse, useAction } from "@/components/use-action";
import { Badge, Button, Field, Input, Modal, MoneyInput, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { centsToInput, formatBRL, parseCents } from "@/modules/finance/money";
import { addDays, formatBizDate, todayBiz } from "@/modules/finance/dates";
import type { TenantState } from "@/modules/tenants/state";
import type { Product } from "@/modules/inventory/stock";
import { formatAccessKey, formatDocument, formatQuantity4, NFE_XML_MAX_CHARS, parseNfeXml, stockQuantity, type NfeDocument, type NfeItem } from "@/modules/inventory/nfe-xml";
import { alreadyImported, findSupplierByDocument, suggestItems, suggestSku, type MatchVia } from "@/modules/inventory/nfe-import";
import { demoSampleNfeXml } from "@/demo/sample-nfe";

type Action = "link" | "create" | "ignore";
interface Row {
  action: Action;
  productId: string;
  via?: MatchVia;
  factor: string;
  name: string;
  sku: string;
  category: string;
  unit: Product["unit"];
  price: string;
  minStock: string;
}

const VIA_LABEL: Record<MatchVia, string> = { vinculo: "lembrado da última nota", barras: "pelo código de barras", sku: "pelo código = SKU" };
const UNIT_FROM_NFE: Record<string, Product["unit"]> = { UN: "un", UND: "un", UNID: "un", PC: "un", KG: "kg", CX: "cx", PCT: "pct", PT: "pct", PAC: "pct" };

function prettyName(s: string): string {
  const lower = s.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
}

function initialRows(state: TenantState, doc: NfeDocument, supplierId?: string): Row[] {
  const sug = suggestItems(state, doc, supplierId);
  const taken = new Set<string>();
  return doc.items.map((it, i) => {
    const s = sug[i]!;
    const sku = suggestSku(state, it, taken);
    taken.add(sku);
    return {
      action: s.productId ? "link" : "create",
      productId: s.productId ?? "",
      via: s.via,
      factor: String(s.factor),
      name: prettyName(it.name),
      sku,
      category: "Geral",
      unit: UNIT_FROM_NFE[it.unit] ?? "un",
      price: "",
      minStock: "0",
    };
  });
}

/** Entrada de mercadoria pelo XML da NF-e do fornecedor: prévia, decisões por item e gravação única. */
export function NfeImportModal({ state, isDemo, onClose }: { state: TenantState; isDemo: boolean; onClose: () => void }) {
  const act = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [xml, setXml] = useState("");
  const [paste, setPaste] = useState("");
  const [doc, setDoc] = useState<NfeDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [supplierChoice, setSupplierChoice] = useState("");
  const [pay, setPay] = useState<"prazo" | "vista">("prazo");
  const [account, setAccount] = useState("acc-banco");
  const [due, setDue] = useState(addDays(todayBiz(), 30));
  const [updateCost, setUpdateCost] = useState(true);
  const [margin, setMargin] = useState("80");
  const [busy, setBusy] = useState(false);

  const stockItems = state.products.filter((p) => p.active && p.trackStock);
  const matchedSupplier = doc ? findSupplierByDocument(state, doc.supplier.document) : undefined;
  const linkableSuppliers = state.suppliers.filter((s) => !s.document);

  const load = (text: string) => {
    setError(null);
    try {
      const d = parseNfeXml(text);
      if (alreadyImported(state, d.accessKey)) {
        setDoc(null);
        return setError(`A NF-e ${d.number} de ${d.supplier.tradeName ?? d.supplier.name} já foi importada. Nada foi alterado.`);
      }
      setXml(text);
      setDoc(d);
      setSupplierChoice("");
      setRows(initialRows(state, d));
      setPay(d.duplicates.length ? "prazo" : "vista");
    } catch (e) {
      setDoc(null);
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > NFE_XML_MAX_CHARS) return setError("Arquivo muito grande para uma NF-e (limite de 1 MB).");
    load(await f.text());
  };

  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const lines = useMemo(
    () =>
      (doc?.items ?? []).map((it, i) => {
        const r = rows[i];
        const factor = Number(r?.factor);
        const qty = r && Number.isInteger(factor) && factor >= 1 && factor <= 10_000 ? stockQuantity(it.quantity4, factor) : null;
        const price = r?.price ? safeParse(() => parseCents(r.price)) : null;
        const unitCost = qty ? Math.round(it.totalCostCents / qty) : null;
        const ok =
          !r || r.action === "ignore"
            ? true
            : qty !== null && qty > 0 && (r.action === "link" ? Boolean(r.productId) : r.name.trim().length > 0 && /^[A-Z0-9-]{2,30}$/.test(r.sku.trim().toUpperCase()) && price !== null);
        return { it, r, qty, unitCost, price, ok };
      }),
    [doc, rows],
  );

  const selected = lines.filter((l) => l.r && l.r.action !== "ignore");
  const ignoredCents = lines.filter((l) => l.r?.action === "ignore").reduce((s, l) => s + l.it.totalCostCents, 0);
  const pendingCount = lines.filter((l) => !l.ok).length;
  const valid = Boolean(doc) && selected.length > 0 && pendingCount === 0;
  const payTotal = doc ? (pay === "prazo" && doc.duplicates.length ? doc.duplicates.reduce((s, d) => s + d.amountCents, 0) : doc.totalCents) : 0;

  const applyMargin = () => {
    const m = Number(margin);
    if (!Number.isFinite(m) || m < 0 || m > 1000) return;
    setRows((rs) => rs.map((r, i) => (r.action === "create" && lines[i]?.unitCost ? { ...r, price: centsToInput(Math.max(1, Math.round((lines[i]!.unitCost! * (100 + m)) / 100))) } : r)));
  };

  const submit = async () => {
    if (!doc) return;
    setBusy(true);
    const r = await act(
      "purchase.importNfe",
      {
        xml,
        supplierId: !matchedSupplier && supplierChoice ? supplierChoice : undefined,
        items: lines.map(({ it, r: row, price }) => ({
          n: it.n,
          action: row!.action,
          factor: Number(row!.factor) || 1,
          productId: row!.action === "link" ? row!.productId : undefined,
          product:
            row!.action === "create"
              ? { name: row!.name.trim(), sku: row!.sku.trim().toUpperCase(), category: row!.category.trim() || "Geral", unit: row!.unit, priceCents: price!, minStock: Math.max(0, Math.floor(Number(row!.minStock) || 0)) }
              : undefined,
        })),
        paidNow: pay === "vista",
        accountId: pay === "vista" ? account : undefined,
        dueDate: pay === "prazo" && !doc.duplicates.length ? due : undefined,
        updateCost,
      },
      `NF-e ${doc.number} importada: ${selected.length} item(ns) no estoque.`,
    );
    setBusy(false);
    if (r.ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Importar XML da nota de compra"
      description="Lê a NF-e do fornecedor e dá entrada no estoque, no custo médio e nas contas a pagar de uma vez."
      footer={
        doc ? (
          <>
            <Button variant="ghost" onClick={() => setDoc(null)}>
              Trocar arquivo
            </Button>
            <Button disabled={!valid || busy} loading={busy} onClick={() => void submit()}>
              <Truck size={16} /> Dar entrada · {formatBRL(payTotal)}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      {!doc ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center transition hover:border-brand/50 hover:bg-brand-soft/40"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
              <FileUp size={22} />
            </span>
            <span className="text-[14px] font-semibold">Escolher o arquivo XML</span>
            <span className="text-[12.5px] text-muted">O fornecedor envia junto com o boleto/DANFE, geralmente por e-mail. Use o .xml, não o PDF.</span>
          </button>
          <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" className="sr-only" aria-label="Arquivo XML da NF-e" onChange={(e) => void onFile(e.target.files?.[0])} />
          <details className="rounded-2xl border border-line p-3">
            <summary className="cursor-pointer text-[13px] font-medium">Ou colar o conteúdo do XML</summary>
            <div className="mt-3 space-y-2">
              <Textarea aria-label="Conteúdo do XML" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="<nfeProc …>" className="font-mono text-[12px]" />
              <Button variant="outline" size="sm" disabled={!paste.trim()} onClick={() => load(paste)}>
                <FileCode2 size={14} /> Ler XML colado
              </Button>
            </div>
          </details>
          {isDemo ? (
            <Button variant="outline" className="w-full" onClick={() => load(demoSampleNfeXml(todayBiz(), 7781 + state.audit.filter((a) => a.action === "purchase.import_nfe").length))}>
              <Sparkles size={16} /> Usar nota de exemplo (fictícia)
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft p-3 text-[13px] text-danger">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}
          <p className="text-[11.5px] text-subtle">O arquivo é lido para conferência; nada é gravado antes de você confirmar. A assinatura digital não é validada: confira a nota no portal da SEFAZ em caso de dúvida.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{doc.supplier.tradeName ?? doc.supplier.name}</div>
                <div className="text-[12px] text-muted">
                  CNPJ {formatDocument(doc.supplier.document)} · NF-e {doc.number}/{doc.series} · emitida em {formatBizDate(doc.issuedOn)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[16px] font-semibold tabular-nums">{formatBRL(doc.totalCents)}</div>
                {doc.authorized ? (
                  <Badge tone="success">Autorizada</Badge>
                ) : (
                  <Badge tone="warn">Sem protocolo de autorização</Badge>
                )}
              </div>
            </div>
            <div className="mt-2 font-mono text-[10.5px] break-all text-subtle">{formatAccessKey(doc.accessKey)}</div>
            <div className="mt-3">
              {matchedSupplier ? (
                <p className="flex items-center gap-1.5 text-[12.5px] text-accent">
                  <CheckCircle2 size={14} /> Fornecedor já cadastrado: {matchedSupplier.name}
                </p>
              ) : (
                <Field label="Fornecedor">
                  {(id) => (
                    <Select id={id} value={supplierChoice} onChange={(e) => setSupplierChoice(e.target.value)}>
                      <option value="">Cadastrar novo: {doc.supplier.tradeName ?? doc.supplier.name}</option>
                      {linkableSuppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          Usar cadastro existente: {s.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">Itens da nota ({doc.items.length})</h3>
              {rows.some((r) => r.action === "create") ? (
                <div className="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-muted">
                  Margem dos novos
                  <span className="w-16 shrink-0">
                    <Input aria-label="Margem" type="number" inputMode="numeric" min={0} max={1000} value={margin} onChange={(e) => setMargin(e.target.value)} className="h-9 px-2" />
                  </span>
                  %
                  <Button size="sm" variant="outline" onClick={applyMargin}>
                    Aplicar
                  </Button>
                </div>
              ) : null}
            </div>
            {pendingCount ? (
              <p className="rounded-xl bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                Falta completar {pendingCount} item(ns) destacado(s): produto do catálogo, preço de venda ou fator.
              </p>
            ) : null}
            {lines.map(({ it, r, qty, unitCost, ok }, i) => (
              <ItemCard key={it.n} item={it} row={r!} qty={qty} unitCost={unitCost} ok={ok} products={stockItems} onChange={(p) => set(i, p)} />
            ))}
          </div>

          <div className="space-y-3 rounded-2xl border border-line p-3">
            <Segmented
              value={pay}
              onChange={setPay}
              options={[
                { value: "prazo", label: doc.duplicates.length ? `Contas a pagar (${doc.duplicates.length} duplicata${doc.duplicates.length > 1 ? "s" : ""})` : "A prazo" },
                { value: "vista", label: "Paga agora" },
              ]}
            />
            {pay === "prazo" ? (
              doc.duplicates.length ? (
                <ul className="divide-y divide-line rounded-xl bg-surface-2 text-[12.5px]">
                  {doc.duplicates.map((d) => (
                    <li key={d.number} className="flex justify-between gap-2 px-3 py-2">
                      <span>
                        {d.number} · vence {formatBizDate(d.dueDate)}
                      </span>
                      <span className="tabular-nums">{formatBRL(d.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Field label="Vencimento" hint="A nota não traz duplicatas; informe quando vai pagar.">
                  {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
                </Field>
              )
            ) : (
              <Field label="Conta de saída">
                {(id) => (
                  <Select id={id} value={account} onChange={(e) => setAccount(e.target.value)}>
                    {state.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {ignoredCents > 0 ? (
              <p className="text-[12px] text-muted">Itens ignorados ({formatBRL(ignoredCents)}) não entram no estoque, mas o valor a pagar segue o total da nota.</p>
            ) : null}
            <Switch checked={updateCost} onChange={setUpdateCost} label="Atualizar custo pelo custo médio" description="O custo de cada item inclui desconto, frete, IPI e ST da nota. Compra não é despesa: o custo entra quando a mercadoria é vendida." />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ItemCard({
  item,
  row,
  qty,
  unitCost,
  ok,
  products,
  onChange,
}: {
  item: NfeItem;
  row: Row;
  qty: number | null;
  unitCost: number | null;
  ok: boolean;
  products: Product[];
  onChange: (p: Partial<Row>) => void;
}) {
  const factorBad = row.action !== "ignore" && qty === null;
  return (
    <div className={`rounded-2xl border p-3 ${ok ? "border-line" : "border-warn/50"}`} data-testid={`nfe-item-${item.n}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium break-words">{item.name}</div>
          <div className="text-[11.5px] text-muted">
            Cód. {item.code}
            {item.barcode ? ` · EAN ${item.barcode}` : ""}
            {item.ncm ? ` · NCM ${item.ncm}` : ""} · {formatQuantity4(item.quantity4)} {item.unit} · {formatBRL(item.totalCostCents)}
          </div>
          {item.lots.length ? (
            <div className="text-[11.5px] text-muted">
              {item.lots.map((l) => [l.lot && `Lote ${l.lot}`, l.expiresOn && `validade ${formatBizDate(l.expiresOn)}`].filter(Boolean).join(" · ")).join(" | ")}
            </div>
          ) : null}
        </div>
        <Segmented
          size="sm"
          value={row.action}
          onChange={(v) => onChange({ action: v })}
          options={[
            { value: "link", label: "Vincular" },
            { value: "create", label: "Criar" },
            { value: "ignore", label: "Ignorar" },
          ]}
        />
      </div>
      {row.action === "ignore" ? null : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {row.action === "link" ? (
            <label className="space-y-1 sm:col-span-2">
              <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-muted">
                <Link2 size={12} /> Produto do catálogo {row.via && row.productId ? <Badge tone="info">{VIA_LABEL[row.via]}</Badge> : null}
              </span>
              <Select aria-label={`Produto do item ${item.n}`} value={row.productId} onChange={(e) => onChange({ productId: e.target.value, via: undefined })}>
                <option value="">Escolha o produto…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <>
              <label className="space-y-1 sm:col-span-2">
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                  <PackagePlus size={12} /> Nome do novo produto
                </span>
                <Input aria-label={`Nome do item ${item.n}`} maxLength={120} value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="block text-[11.5px] font-medium text-muted">SKU</span>
                <Input aria-label={`SKU do item ${item.n}`} maxLength={30} value={row.sku} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} />
              </label>
              <label className="space-y-1">
                <span className="block text-[11.5px] font-medium text-muted">Preço de venda</span>
                <MoneyInput aria-label={`Preço de venda do item ${item.n}`} value={row.price} onChange={(e) => onChange({ price: e.target.value })} placeholder={unitCost ? `custo ${formatBRL(unitCost)}` : undefined} />
              </label>
              <label className="space-y-1">
                <span className="block text-[11.5px] font-medium text-muted">Categoria</span>
                <Input aria-label={`Categoria do item ${item.n}`} maxLength={40} value={row.category} onChange={(e) => onChange({ category: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="block text-[11.5px] font-medium text-muted">Estoque mínimo</span>
                <Input aria-label={`Estoque mínimo do item ${item.n}`} type="number" min={0} inputMode="numeric" value={row.minStock} onChange={(e) => onChange({ minStock: e.target.value })} />
              </label>
            </>
          )}
          <label className="space-y-1">
            <span className="block text-[11.5px] font-medium text-muted">
              Fator: 1 {item.unit} = quantas unidades de estoque
            </span>
            <Input aria-label={`Fator do item ${item.n}`} type="number" min={1} max={10000} inputMode="numeric" value={row.factor} onChange={(e) => onChange({ factor: e.target.value })} />
          </label>
          <div className={`self-end rounded-xl px-3 py-2 text-[12.5px] ${factorBad ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"}`}>
            {factorBad ? (
              `${formatQuantity4(item.quantity4)} ${item.unit} × fator não dá número inteiro. Ajuste o fator.`
            ) : (
              <>
                Entram <strong className="text-fg">{qty}</strong> un. · custo {unitCost !== null ? formatBRL(unitCost) : "—"}/un.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
