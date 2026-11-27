"use client";
import { useMemo, useState } from "react";
import { MessageCircle, Pencil, UserPlus, Users, HandCoins } from "lucide-react";
import { useTenant } from "@/demo/use-demo";
import { safeParse, useAction } from "@/components/use-action";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, SearchInput, Segmented, Select, Textarea, cn } from "@/components/ui";
import { centsToInput, formatBRL, parseCents } from "@/modules/finance/money";
import { formatBizDate, todayBiz } from "@/modules/finance/dates";
import { openCents, titleStatus } from "@/modules/finance/titles";
import { formatPhone, whatsappLink, type Customer } from "@/modules/customers/customer";
import { ACCOUNT_BANK, ACCOUNT_DRAWER, type TenantState } from "@/modules/tenants/state";

type Filter = "todos" | "devendo";

export function CustomersView() {
  const t = useTenant();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [form, setForm] = useState<Customer | "new" | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const stats = useMemo(() => {
    const m = new Map<string, { spent: number; count: number; open: number; last?: string }>();
    if (!t) return m;
    for (const s of t.state.sales) {
      if (!s.customerId || s.status !== "concluida") continue;
      const cur = m.get(s.customerId) ?? { spent: 0, count: 0, open: 0 };
      cur.spent += s.totalCents;
      cur.count += 1;
      cur.last = !cur.last || s.date > cur.last ? s.date : cur.last;
      m.set(s.customerId, cur);
    }
    for (const ti of t.state.titles) {
      if (ti.kind !== "receivable" || !ti.counterpartyId) continue;
      const cur = m.get(ti.counterpartyId) ?? { spent: 0, count: 0, open: 0 };
      cur.open += openCents(ti);
      m.set(ti.counterpartyId, cur);
    }
    return m;
  }, [t]);
  if (!t) return null;
  const term = q.trim().toLowerCase();
  const list = t.state.customers
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone?.includes(term.replace(/\D/g, "") || "§"))
    .filter((c) => filter === "todos" || (stats.get(c.id)?.open ?? 0) > 0)
    .sort((a, b) => (stats.get(b.id)?.open ?? 0) - (stats.get(a.id)?.open ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
  const totalOpen = [...stats.values()].reduce((s, x) => s + x.open, 0);

  return (
    <div className="animate-in">
      <PageHeader
        title="Clientes"
        description="Cadastro mínimo, histórico de compras e cobrança de fiado pelo WhatsApp."
        actions={
          <Button onClick={() => setForm("new")}>
            <UserPlus size={16} /> Novo cliente
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="flex-1" value={q} onChange={setQ} placeholder="Buscar por nome ou telefone" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todos", label: `Todos (${t.state.customers.length})` },
            { value: "devendo", label: `Com fiado · ${formatBRL(totalOpen)}` },
          ]}
        />
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<Users size={24} />}
            title={t.state.customers.length ? "Nenhum cliente neste filtro" : "Nenhum cliente cadastrado"}
            description="Cadastre só o necessário: nome e telefone já bastam."
            action={!t.state.customers.length ? <Button onClick={() => setForm("new")}>Cadastrar cliente</Button> : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((c) => {
              const st = stats.get(c.id);
              return (
                <li key={c.id}>
                  <button onClick={() => setDetail(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 sm:px-5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-accent/80 text-[13px] font-semibold text-white">{c.name[0]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{c.name}</span>
                      <span className="block text-[12px] text-muted">
                        {formatPhone(c.phone) || "Sem telefone"} · {st?.count ?? 0} compra(s)
                      </span>
                    </span>
                    <span className="text-right">
                      {st?.open ? <Badge tone="warn">Deve {formatBRL(st.open)}</Badge> : <span className="text-[13px] text-muted tabular">{formatBRL(st?.spent ?? 0)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {form ? <CustomerForm customer={form === "new" ? null : form} onClose={() => setForm(null)} /> : null}
      {detail ? (
        <CustomerDetail
          id={detail}
          state={t.state}
          onEdit={(c) => {
            setDetail(null);
            setForm(c);
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", notes: customer?.notes ?? "" });
  const save = async () => {
    const r = customer ? await act("customer.update", { id: customer.id, ...f }, "Cliente atualizado.") : await act("customer.create", f, "Cliente cadastrado.");
    if (r.ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={customer ? "Editar cliente" : "Novo cliente"}
      description="Pedimos só o essencial (LGPD: minimização de dados)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={f.name.trim().length < 2}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Nome">{(id) => <Input id={id} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp / telefone" hint="Com DDD.">
            {(id) => <Input id={id} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(81) 99999-0000" />}
          </Field>
          <Field label="E-mail (opcional)">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        </div>
        <Field label="Observações (opcional)">{(id) => <Textarea id={id} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

function CustomerDetail({ id, state, onEdit, onClose }: { id: string; state: TenantState; onEdit: (c: Customer) => void; onClose: () => void }) {
  const act = useAction();
  const [settling, setSettling] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState(ACCOUNT_DRAWER);
  const c = state.customers.find((x) => x.id === id);
  if (!c) return null;
  const today = todayBiz();
  const sales = state.sales.filter((s) => s.customerId === id).sort((a, b) => b.number - a.number);
  const titles = state.titles.filter((t) => t.kind === "receivable" && t.counterpartyId === id && openCents(t) > 0);
  const open = titles.reduce((s, t) => s + openCents(t), 0);
  const firstName = c.name.split(" ")[0];
  const msg = `Olá, ${firstName}! Tudo bem? Passando para lembrar do valor em aberto de ${formatBRL(open)} na ${state.tenant.tradeName}. Qualquer dúvida, é só chamar. Obrigado!`;
  const wa = c.phone ? whatsappLink(c.phone, msg) : null;
  const target = titles.find((t) => t.id === settling);
  const cents = amount ? safeParse(() => parseCents(amount)) : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={c.name}
      description={`${formatPhone(c.phone) || "Sem telefone"}${c.email ? ` · ${c.email}` : ""}`}
      footer={
        <>
          <Button variant="outline" onClick={() => onEdit(c)}>
            <Pencil size={16} /> Editar
          </Button>
          {wa && open > 0 ? (
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <Button variant="success" className="w-full">
                <MessageCircle size={16} /> Cobrar no WhatsApp
              </Button>
            </a>
          ) : wa ? (
            <a href={whatsappLink(c.phone!, `Olá, ${firstName}!`)!} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="w-full">
                <MessageCircle size={16} /> WhatsApp
              </Button>
            </a>
          ) : null}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Compras" value={String(sales.filter((s) => s.status === "concluida").length)} />
        <Mini label="Total gasto" value={formatBRL(sales.filter((s) => s.status === "concluida").reduce((a, s) => a + s.totalCents, 0))} />
        <Mini label="Em aberto" value={formatBRL(open)} tone={open ? "warn" : undefined} />
      </div>
      {c.notes ? <p className="mt-3 rounded-xl bg-surface-2 p-3 text-[13px] text-muted">{c.notes}</p> : null}
      {titles.length ? (
        <>
          <h3 className="mt-5 mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <HandCoins size={15} /> Fiado em aberto
          </h3>
          <ul className="space-y-2">
            {titles.map((ti) => (
              <li key={ti.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{ti.description}</div>
                    <div className="text-[12px] text-muted">Vence {formatBizDate(ti.dueDate)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[14px] font-semibold tabular">{formatBRL(openCents(ti))}</div>
                    {titleStatus(ti, today) === "vencido" ? <Badge tone="danger">Vencido</Badge> : titleStatus(ti, today) === "parcial" ? <Badge tone="info">Parcial</Badge> : null}
                  </div>
                </div>
                {settling === ti.id && target ? (
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_150px_auto]">
                    <MoneyInput aria-label="Valor recebido" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <Select aria-label="Conta" value={account} onChange={(e) => setAccount(e.target.value)} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-1">
                      <option value={ACCOUNT_DRAWER}>Gaveta</option>
                      <option value={ACCOUNT_BANK}>Conta PJ</option>
                    </Select>
                    <Button
                      disabled={cents === null}
                      onClick={async () => {
                        const r = await act("title.settle", { titleId: ti.id, amountCents: cents!, date: today, accountId: account }, "Recebimento registrado.");
                        if (r.ok) setSettling(null);
                      }}
                    >
                      Receber
                    </Button>
                  </div>
                ) : (
                  <button
                    className="mt-2 text-[12.5px] font-medium text-brand"
                    onClick={() => {
                      setSettling(ti.id);
                      setAmount(centsToInput(openCents(ti)));
                    }}
                  >
                    Registrar recebimento (total ou parcial)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="mt-5 mb-2 text-[13px] font-semibold">Histórico de compras</h3>
      {sales.length === 0 ? (
        <p className="text-[13px] text-muted">Nenhuma compra registrada.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {sales.slice(0, 15).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 truncate">
                <span className="text-muted">
                  #{s.number} · {formatBizDate(s.date)}
                </span>{" "}
                · {s.items.map((i) => i.name).join(", ")}
              </span>
              <span className={cn("shrink-0 tabular", s.status === "devolvida" && "text-subtle line-through")}>{formatBRL(s.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={cn("mt-0.5 truncate text-[13.5px] font-semibold tabular", tone === "warn" && "text-warn")}>{value}</div>
    </div>
  );
}
