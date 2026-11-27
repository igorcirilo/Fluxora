"use client";
import { useState } from "react";
import { Plus, Truck, X } from "lucide-react";
import { safeParse, useAction } from "@/components/use-action";
import { Button, Field, Input, Modal, MoneyInput, Segmented, Select, Switch } from "@/components/ui";
import { formatBRL, parseCents } from "@/modules/finance/money";
import { addDays, todayBiz } from "@/modules/finance/dates";
import type { TenantState } from "@/modules/tenants/state";

interface Line {
  productId: string;
  qty: string;
  cost: string;
  lot: string;
  expiresOn: string;
}

/** Entrada de mercadoria: estoque + custo médio + pagamento (à vista ou contas a pagar). */
export function PurchaseModal({ state, onClose }: { state: TenantState; onClose: () => void }) {
  const act = useAction();
  const stockItems = state.products.filter((p) => p.active && p.trackStock);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: stockItems[0]?.id ?? "", qty: "", cost: "", lot: "", expiresOn: "" }]);
  const [pay, setPay] = useState<"vista" | "prazo">("prazo");
  const [account, setAccount] = useState("acc-banco");
  const [due, setDue] = useState(addDays(todayBiz(), 30));
  const [installments, setInstallments] = useState("1");
  const [doc, setDoc] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [busy, setBusy] = useState(false);

  const parsed = lines.map((l) => ({ ...l, q: Number(l.qty), c: l.cost ? safeParse(() => parseCents(l.cost, { allowZero: true })) : null }));
  const valid = parsed.every((l) => l.productId && Number.isInteger(l.q) && l.q > 0 && l.c !== null) && (pay === "vista" || (Number(installments) >= 1 && Number(installments) <= 48));
  const total = parsed.reduce((s, l) => s + (Number.isInteger(l.q) && l.c !== null ? l.q * l.c : 0), 0);
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const submit = async () => {
    setBusy(true);
    let sid = supplierId || undefined;
    if (supplierId === "__novo") {
      const r = await act("supplier.create", { name: newSupplier });
      if (!r.ok) return setBusy(false);
      sid = r.value as string;
    }
    const r = await act(
      "purchase.receive",
      {
        supplierId: sid,
        items: parsed.map((l) => ({ productId: l.productId, quantity: l.q, unitCostCents: l.c!, lot: l.lot.trim() || undefined, expiresOn: l.expiresOn || undefined })),
        paidNow: pay === "vista",
        accountId: pay === "vista" ? account : undefined,
        firstDueDate: pay === "prazo" ? due : undefined,
        installments: pay === "prazo" ? Number(installments) : undefined,
        updateCost,
        document: doc.trim() || undefined,
      },
      "Entrada de mercadoria registrada.",
    );
    setBusy(false);
    if (r.ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Entrada de mercadoria"
      description="Registra estoque, lote/validade, custo médio e o pagamento ao fornecedor."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!valid || busy || (supplierId === "__novo" && newSupplier.trim().length < 2)} loading={busy} onClick={() => void submit()}>
            <Truck size={16} /> Registrar entrada · {formatBRL(total)}
          </Button>
        </>
      }
    >
      {stockItems.length === 0 ? (
        <p className="rounded-xl bg-warn-soft p-3 text-[13px] text-warn">Cadastre produtos com controle de estoque antes de registrar compras.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fornecedor">
              {(id) => (
                <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Não informado</option>
                  {state.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__novo">+ Novo fornecedor…</option>
                </Select>
              )}
            </Field>
            {supplierId === "__novo" ? (
              <Field label="Nome do novo fornecedor">{(id) => <Input id={id} value={newSupplier} maxLength={120} onChange={(e) => setNewSupplier(e.target.value)} />}</Field>
            ) : (
              <Field label="Nº da nota / documento (opcional)">{(id) => <Input id={id} value={doc} maxLength={60} onChange={(e) => setDoc(e.target.value)} />}</Field>
            )}
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-2xl border border-line p-3 sm:grid-cols-[2fr_80px_120px_100px_140px_auto]">
                <Select aria-label="Produto" className="col-span-2 sm:col-span-1" value={l.productId} onChange={(e) => set(i, { productId: e.target.value })}>
                  {stockItems.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Input aria-label="Quantidade" type="number" min={1} inputMode="numeric" placeholder="Qtd." value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                <MoneyInput aria-label="Custo unitário" placeholder="Custo un." value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
                <Input aria-label="Lote" placeholder="Lote" maxLength={40} value={l.lot} onChange={(e) => set(i, { lot: e.target.value })} />
                <Input aria-label="Validade" type="date" value={l.expiresOn} onChange={(e) => set(i, { expiresOn: e.target.value })} />
                {lines.length > 1 ? (
                  <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </Button>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { productId: stockItems[0]!.id, qty: "", cost: "", lot: "", expiresOn: "" }])}>
              <Plus size={14} /> Adicionar item
            </Button>
          </div>

          <div className="space-y-3 rounded-2xl border border-line p-3">
            <Segmented value={pay} onChange={setPay} options={[{ value: "prazo", label: "A prazo (contas a pagar)" }, { value: "vista", label: "Paga agora" }]} />
            {pay === "vista" ? (
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
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="1º vencimento">{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
                <Field label="Parcelas">{(id) => <Input id={id} type="number" min={1} max={48} value={installments} onChange={(e) => setInstallments(e.target.value)} />}</Field>
              </div>
            )}
            <Switch checked={updateCost} onChange={setUpdateCost} label="Atualizar custo pelo custo médio" description="Mantém a margem estimada correta. Compras não viram despesa: o custo entra quando a mercadoria é vendida." />
          </div>
        </div>
      )}
    </Modal>
  );
}
