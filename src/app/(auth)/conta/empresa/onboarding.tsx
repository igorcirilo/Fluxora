"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, Mail, Store } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { getAccountStore, setMode } from "@/demo/use-demo";
import { todayBiz } from "@/modules/finance/dates";

export function CompanyOnboarding() {
  const router = useRouter();
  const [f, setF] = useState({ tradeName: "", openedOn: todayBiz(), segment: "comercio" as "comercio" | "servicos" | "misto" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ tenantId: string; linkId: string; companyLabel: string }[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    getAccountStore()
      ?.invites()
      .then(setInvites)
      .catch(() => setInvites([]));
  }, []);
  const accept = async (tenantId: string, linkId: string) => {
    setBusy(true);
    setError(null);
    const r = await getAccountStore()!.acceptInvite(tenantId, linkId, codes[linkId] ?? "");
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setMode("conta");
    router.push("/contador");
  };
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
    <div className="flex min-h-dvh flex-col items-center justify-start gap-4 px-4 py-8 sm:justify-center">
      {invites.length ? (
        <div className="w-full max-w-md space-y-3 rounded-3xl border border-brand/30 bg-surface p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold">
            <Mail size={18} className="text-brand" /> Você foi convidado(a) como contador(a)
          </h2>
          {invites.map((i) => (
            <div key={i.linkId} className="rounded-xl border border-line p-3">
              <div className="text-[14px] font-medium">{i.companyLabel || "Empresa"}</div>
              <div className="mt-2 flex gap-2">
                <Input aria-label={`Código do convite de ${i.companyLabel}`} placeholder="Código (8 caracteres)" maxLength={8} className="font-mono uppercase" value={codes[i.linkId] ?? ""} onChange={(e) => setCodes({ ...codes, [i.linkId]: e.target.value.toUpperCase() })} />
                <Button type="button" disabled={(codes[i.linkId] ?? "").length !== 8 || busy} onClick={() => void accept(i.tenantId, i.linkId)}>
                  <KeyRound size={15} /> Aceitar
                </Button>
              </div>
            </div>
          ))}
          <p className="text-[12px] text-subtle">Se você também é titular de um MEI, pode cadastrar sua empresa abaixo.</p>
        </div>
      ) : null}
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
