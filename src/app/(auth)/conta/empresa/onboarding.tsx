"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Store } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { getAccountStore, setMode } from "@/demo/use-demo";
import { todayBiz } from "@/modules/finance/dates";

export function CompanyOnboarding() {
  const router = useRouter();
  const [f, setF] = useState({ tradeName: "", openedOn: todayBiz(), segment: "comercio" as "comercio" | "servicos" | "misto" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await getAccountStore()!.createTenant(f);
    setBusy(false);
    if (!r.ok) return setError(r.code === "TENANT_ACCESS_DENIED" ? "Sessão expirada. Entre novamente." : r.message);
    setMode("conta");
    router.push("/painel");
  };
  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-8 sm:items-center">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <Logo />
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <Store size={22} /> Sua empresa
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">Leva menos de um minuto. Você poderá ajustar tudo depois em Configurações.</p>
        </div>
        <Field label="Nome fantasia">{(id) => <Input id={id} required maxLength={80} value={f.tradeName} onChange={(e) => setF({ ...f, tradeName: e.target.value })} placeholder="Ex.: Mercearia da Praça" />}</Field>
        <Field label="Data de abertura do MEI" hint="Usada no limite proporcional do ano de abertura.">{(id) => <Input id={id} type="date" required max={todayBiz()} value={f.openedOn} onChange={(e) => setF({ ...f, openedOn: e.target.value })} />}</Field>
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium">Segmento</span>
          <Segmented value={f.segment} onChange={(v) => setF({ ...f, segment: v })} options={[{ value: "comercio", label: "Comércio" }, { value: "servicos", label: "Serviços" }, { value: "misto", label: "Ambos" }]} />
        </div>
        {error ? <p role="alert" className="rounded-xl bg-danger-soft p-3 text-[13px] text-danger">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Começar <ArrowRight size={17} />
        </Button>
      </form>
    </div>
  );
}
