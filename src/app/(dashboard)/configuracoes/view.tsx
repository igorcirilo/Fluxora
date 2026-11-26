"use client";
import { useState } from "react";
import type { Tenant } from "@/modules/tenants/state";
import { Building2, Database, Download, History, Monitor, Moon, Palette, RefreshCcw, ShieldCheck, Sun, UserCheck, CreditCard, Info } from "lucide-react";
import { useTenant, getStore } from "@/demo/use-demo";
import { useAction } from "@/components/use-action";
import { downloadText } from "@/components/csv";
import { applyTheme, getThemePref, type ThemePref } from "@/components/shell/theme";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, PageHeader, Segmented, Select, Switch, useToast } from "@/components/ui";
import { updateTenant, grantAccountant, revokeAccountant } from "@/modules/tenants/ops";
import { isLinkActive } from "@/modules/accounting/links";
import { PLANS } from "@/modules/billing/provider";
import { formatBRL } from "@/modules/finance/money";
import { todayBiz } from "@/modules/finance/dates";

const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

export function SettingsView() {
  const t = useTenant();
  const act = useAction();
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePref>(() => (typeof window === "undefined" ? "system" : getThemePref()));
  const [grantOpen, setGrantOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  if (!t) return null;
  const s = t.state;

  return (
    <div className="animate-in">
      <PageHeader title="Configurações" description="Empresa, aparência, contador, dados e auditoria." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompanyCard key={JSON.stringify(s.tenant)} tenant={s.tenant} />

        <Card>
          <CardHeader title="Aparência" action={<Palette size={18} className="text-subtle" />} />
          <CardBody>
            <Segmented
              value={theme}
              onChange={(v) => {
                setTheme(v);
                applyTheme(v);
              }}
              options={[
                {
                  value: "light",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Sun size={14} /> Claro
                    </span>
                  ),
                },
                {
                  value: "dark",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Moon size={14} /> Escuro
                    </span>
                  ),
                },
                {
                  value: "system",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Monitor size={14} /> Sistema
                    </span>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contador" subtitle="Vínculo autorizado por você e revogável a qualquer momento" action={<UserCheck size={18} className="text-subtle" />} />
          <CardBody className="space-y-2">
            {s.accountantLinks.length === 0 ? <p className="text-[13px] text-muted">Nenhum contador vinculado.</p> : null}
            {s.accountantLinks.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{l.accountantName}</div>
                  <div className="truncate text-[12px] text-muted">
                    {l.firm} · {l.scopes.map((x) => (x === "read" ? "leitura" : "exportação")).join(" + ")}
                  </div>
                </div>
                {isLinkActive(l) ? (
                  <Button size="sm" variant="outline" onClick={() => act((st, c) => revokeAccountant(st, l.id, c), "Acesso do contador revogado.")}>
                    Revogar
                  </Button>
                ) : (
                  <Badge>Revogado</Badge>
                )}
              </div>
            ))}
            <Button variant="secondary" className="w-full" onClick={() => setGrantOpen(true)}>
              Convidar contador
            </Button>
            <p className="text-[12px] text-subtle">
              Na versão com backend, o contador acessa um painel próprio somente das empresas que autorizaram. Dados nunca são compartilhados entre escritórios.
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Plano" subtitle="Piloto gratuito até a formalização da cobrança" action={<CreditCard size={18} className="text-subtle" />} />
          <CardBody className="space-y-2">
            {PLANS.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium">{p.name}</div>
                  <div className="text-[12px] text-muted">{p.description}</div>
                </div>
                <div className="shrink-0 text-right text-[13px] font-semibold tabular">{formatBRL(p.priceCents)}/mês</div>
              </div>
            ))}
            <p className="text-[12px] text-subtle">Preços de teste, não vigentes. Nenhuma cobrança é realizada.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Seus dados" subtitle="Portabilidade e controle (LGPD)" action={<Database size={18} className="text-subtle" />} />
          <CardBody className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const r = getStore()?.exportCurrent();
                if (r?.ok) downloadText(`fluxora-${s.tenant.id}-${todayBiz()}.json`, r.value);
              }}
            >
              <Download size={16} /> Exportar todos os dados (JSON)
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setResetOpen(true)}>
              <RefreshCcw size={16} /> Restaurar dados de demonstração
            </Button>
            <p className="flex gap-2 text-[12px] text-subtle">
              <ShieldCheck size={14} className="mt-px shrink-0" /> Neste modo, os dados ficam apenas no armazenamento local deste navegador; nada é enviado a servidores.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Auditoria" subtitle="Últimas ações registradas" action={<History size={18} className="text-subtle" />} />
          <CardBody className="pt-3">
            <ul className="max-h-64 space-y-2 overflow-y-auto text-[12.5px]">
              {s.audit
                .slice(-25)
                .reverse()
                .map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-[11.5px]">{a.action}</span>
                    <span className="shrink-0 text-subtle">
                      {new Date(a.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardBody className="flex items-start gap-3 text-[12.5px] text-muted">
          <Info size={16} className="mt-px shrink-0" />
          <p>
            Fluxora v0.1 — demonstração navegável. Sem login real, sem banco de dados no servidor, sem emissão fiscal e sem cobranças. A arquitetura final usa PostgreSQL com isolamento por empresa
            (RLS), autenticação forte e implantação em VPS com Docker/Coolify. Cálculos são gerenciais e não substituem o contador.
          </p>
        </CardBody>
      </Card>

      {grantOpen ? <GrantModal onClose={() => setGrantOpen(false)} /> : null}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        size="sm"
        title="Restaurar dados de demonstração?"
        description="Todas as alterações feitas neste navegador serão descartadas e os dados fictícios serão gerados novamente."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                getStore()?.reset();
                setResetOpen(false);
                toast("success", "Dados de demonstração restaurados.");
              }}
            >
              Restaurar
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">Empresas criadas do zero também serão removidas.</p>
      </Modal>
    </div>
  );
}

function GrantModal({ onClose }: { onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ accountantName: "", firm: "", email: "", exportScope: true });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Convidar contador"
      description="Na demonstração nenhum e-mail é enviado."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              const r = act(
                (s, c) => grantAccountant(s, { accountantName: f.accountantName, firm: f.firm, email: f.email, scopes: f.exportScope ? ["read", "export"] : ["read"] }, c),
                "Vínculo criado.",
              );
              if (r.ok) onClose();
            }}
          >
            Autorizar acesso
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Nome do contador">{(id) => <Input id={id} value={f.accountantName} onChange={(e) => setF({ ...f, accountantName: e.target.value })} />}</Field>
        <Field label="Escritório">{(id) => <Input id={id} value={f.firm} onChange={(e) => setF({ ...f, firm: e.target.value })} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Switch checked={f.exportScope} onChange={(v) => setF({ ...f, exportScope: v })} label="Permitir exportação" description="Leitura é sempre incluída." />
      </div>
    </Modal>
  );
}

function CompanyCard({ tenant }: { tenant: Tenant }) {
  const act = useAction();
  const [form, setForm] = useState(tenant);
  return (
    <Card className="lg:row-span-2">
      <CardHeader title="Empresa" subtitle="Dados usados nos relatórios e no limite MEI" action={<Building2 size={18} className="text-subtle" />} />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome fantasia">{(id) => <Input id={id} value={form.tradeName} maxLength={80} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />}</Field>
        <Field label="Nome empresarial">{(id) => <Input id={id} value={form.name} maxLength={150} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
        <Field label="Abertura do MEI" hint="Afeta o limite proporcional do ano de abertura.">
          {(id) => <Input id={id} type="date" value={form.openedOn} max={todayBiz()} onChange={(e) => setForm({ ...form, openedOn: e.target.value })} />}
        </Field>
        <Field label="Regime">
          {(id) => (
            <Select id={id} value={form.regime} disabled>
              <option value="mei-geral">MEI (geral)</option>
            </Select>
          )}
        </Field>
        <Field label="Segmento">
          {(id) => (
            <Select id={id} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as typeof form.segment })}>
              <option value="comercio">Comércio</option>
              <option value="servicos">Serviços</option>
              <option value="misto">Comércio e serviços</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-[1fr_90px] gap-3">
          <Field label="Cidade">{(id) => <Input id={id} value={form.city} maxLength={60} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
          <Field label="UF">
            {(id) => (
              <Select id={id} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Switch
            checked={form.allowNegativeStock}
            onChange={(v) => setForm({ ...form, allowNegativeStock: v })}
            label="Permitir estoque negativo"
            description="Quando desligado, o PDV bloqueia vendas sem saldo."
          />
        </div>
        <p className="rounded-xl bg-surface-2 p-3 text-[12.5px] text-muted sm:col-span-2">MEI caminhoneiro possui regras próprias e ainda não é suportado.</p>
        <div className="flex justify-end sm:col-span-2">
          <Button
            onClick={() =>
              act(
                (st, c) =>
                  updateTenant(
                    st,
                    { name: form.name, tradeName: form.tradeName, openedOn: form.openedOn, segment: form.segment, city: form.city, uf: form.uf, allowNegativeStock: form.allowNegativeStock },
                    c,
                  ),
                "Dados da empresa salvos.",
              )
            }
          >
            Salvar alterações
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
