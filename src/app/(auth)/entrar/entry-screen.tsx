"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Cake, Sparkles, Store, ShieldCheck, Wallet, ScanLine, FlaskConical, Plus, Lock } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button, Field, Input, Modal, Segmented } from "@/components/ui";
import { getStore, useDemoDb } from "@/demo/use-demo";
import { DEMO_TENANT_A, DEMO_TENANT_B } from "@/demo/seed";
import { todayBiz } from "@/modules/finance/dates";

const FEATURES = [
  { icon: ScanLine, title: "Venda em poucos toques", text: "PDV com carrinho, troco, Pix, cartão e fiado." },
  { icon: Wallet, title: "Caixa ≠ lucro, sem confusão", text: "Competência, vencimento e recebimento separados." },
  { icon: ShieldCheck, title: "Limite MEI em linguagem simples", text: "Alertas em 80%, 90% e 100%, com projeção." },
];

export function EntryScreen() {
  const router = useRouter();
  const db = useDemoDb();
  const [loading, setLoading] = useState<string | null>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  const [form, setForm] = useState({ tradeName: "", openedOn: todayBiz(), segment: "comercio" as "comercio" | "servicos" | "misto", ownerName: "" });
  const [error, setError] = useState<string | null>(null);

  const enter = (userId: string, key: string) => {
    setLoading(key);
    // Pequeno atraso para o carregamento inicial dos dados fictícios não travar a interação.
    setTimeout(() => {
      const r = getStore()?.login(userId);
      if (r?.ok) router.push("/painel");
      else setLoading(null);
    }, 30);
  };

  const createBlank = () => {
    const r = getStore()?.createBlankTenant(form);
    if (!r) return;
    if (!r.ok) return setError(r.message);
    router.push("/painel");
  };

  const tA = db?.tenants[DEMO_TENANT_A];
  const tB = db?.tenants[DEMO_TENANT_B];

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="bg-brand-gradient relative overflow-hidden px-6 pt-8 pb-10 text-white sm:px-10 lg:flex lg:flex-col lg:justify-between lg:p-14">
        <Logo light />
        <div className="mt-10 max-w-xl lg:mt-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[12px] font-medium backdrop-blur">
            <Sparkles size={13} /> Gestão para MEI de comércio e serviços
          </span>
          <h1 className="mt-5 text-[32px] leading-[1.08] font-semibold tracking-tight sm:text-5xl">
            Saiba quanto entrou, <span className="text-gradient">quanto saiu</span> e quanto falta para o limite.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">Registre vendas, acompanhe o caixa e as obrigações do MEI e compartilhe tudo com o seu contador — sem planilhas.</p>
          <ul className="mt-8 hidden gap-4 sm:grid">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-[14.5px] font-medium">{title}</span>
                  <span className="block text-[13.5px] text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 hidden text-[12px] text-white/45 lg:block">Fluxora v0.1 · Demonstração sem backend persistente · Não substitui o contador</p>
      </section>

      <section className="flex items-start justify-center px-4 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-warn/30 bg-warn-soft p-3.5 text-[13px] leading-snug text-warn">
            <FlaskConical size={17} className="mt-px shrink-0" />
            <p>
              <b>Ambiente de demonstração.</b> Todos os dados são fictícios e ficam apenas neste navegador. Não há emissão fiscal nem pagamentos reais.
            </p>
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight">Escolha uma empresa para explorar</h2>
          <p className="mt-1 text-[13.5px] text-muted">Cada empresa é isolada: uma não enxerga os dados da outra.</p>

          <div className="mt-5 space-y-3">
            <DemoCard
              icon={<Cake size={22} />}
              title="Doceria Aurora"
              subtitle="Comércio · Recife/PE · aberta há 2+ anos"
              meta={tA ? `${tA.sales.length.toLocaleString("pt-BR")} vendas fictícias · ${tA.products.length} produtos` : "Gerando dados fictícios…"}
              gradient="from-[#8a80ff] to-[#d36bff]"
              loading={loading === "a"}
              onClick={() => enter("usr_ana", "a")}
            />
            <DemoCard
              icon={<Sparkles size={22} />}
              title="Studio Bela Forma"
              subtitle="Serviços · Olinda/PE · aberto neste ano"
              meta={tB ? `${tB.sales.length.toLocaleString("pt-BR")} atendimentos fictícios · limite proporcional` : "Gerando dados fictícios…"}
              gradient="from-[#12b886] to-[#2f80ed]"
              loading={loading === "b"}
              onClick={() => enter("usr_bruno", "b")}
            />
            <button
              onClick={() => setBlankOpen(true)}
              className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong p-4 text-left transition hover:border-brand hover:bg-brand-soft/40"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-muted">
                <Plus size={20} />
              </span>
              <span className="flex-1">
                <span className="block text-[14.5px] font-semibold">Começar do zero</span>
                <span className="block text-[12.5px] text-muted">Crie uma empresa fictícia vazia e veja o onboarding</span>
              </span>
              <Store size={18} className="text-subtle" />
            </button>
          </div>

          <div className="mt-6 flex items-start gap-2 text-[12px] text-subtle">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <p>Login real (e-mail, senha forte, MFA para administradores) será ativado com o banco PostgreSQL. Nesta demonstração não há contas reais.</p>
          </div>
        </div>
      </section>

      <Modal
        open={blankOpen}
        onClose={() => setBlankOpen(false)}
        title="Nova empresa (fictícia)"
        description="Os dados ficam apenas neste navegador."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlankOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={createBlank}>
              Criar e entrar <ArrowRight size={16} />
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome fantasia" error={error}>
            {(id) => <Input id={id} value={form.tradeName} maxLength={80} placeholder="Ex.: Ateliê da Esquina" onChange={(e) => setForm({ ...form, tradeName: e.target.value })} />}
          </Field>
          <Field label="Seu nome" hint="Apenas para exibição.">
            {(id) => <Input id={id} value={form.ownerName} maxLength={60} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />}
          </Field>
          <Field label="Data de abertura do MEI" hint="Usada no limite proporcional do ano de abertura.">
            {(id) => <Input id={id} type="date" value={form.openedOn} max={todayBiz()} onChange={(e) => setForm({ ...form, openedOn: e.target.value })} />}
          </Field>
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium">Segmento</span>
            <Segmented
              value={form.segment}
              onChange={(v) => setForm({ ...form, segment: v })}
              options={[
                { value: "comercio", label: "Comércio" },
                { value: "servicos", label: "Serviços" },
                { value: "misto", label: "Ambos" },
              ]}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function DemoCard({
  icon,
  title,
  subtitle,
  meta,
  gradient,
  onClick,
  loading,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  meta: string;
  gradient: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="group flex w-full items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-pop disabled:opacity-70"
    >
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-[12.5px] text-muted">{subtitle}</span>
        <span className="mt-1 block truncate text-[12px] text-subtle">{meta}</span>
      </span>
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      ) : (
        <ArrowRight size={18} className="text-subtle transition group-hover:translate-x-0.5 group-hover:text-brand" />
      )}
    </button>
  );
}
