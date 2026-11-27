"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { authClient } from "@/client/auth-client";
import { getAccountStore, setMode } from "@/demo/use-demo";

type Step = "form" | "totp";

export function AccountEntry() {
  const router = useRouter();
  const [tab, setTab] = useState<"entrar" | "criar">("entrar");
  const [step, setStep] = useState<Step>("form");
  const [f, setF] = useState({ name: "", email: "", password: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/app/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEnabled(!!j.enabled))
      .catch(() => setEnabled(false));
  }, []);

  const done = async () => {
    setMode("conta");
    await getAccountStore()!.refresh();
    const s = getAccountStore()!.getSnapshot();
    const onlyAccountant = s.tenants.length > 0 && s.tenants.every((x) => x.role === "accountant");
    router.push(s.status === "no-tenant" ? "/conta/empresa" : onlyAccountant ? "/contador" : "/painel");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "totp") {
        const r = await authClient.twoFactor.verifyTotp({ code: f.code.replace(/\s/g, "") });
        if (r.error) return setError(r.error.message ?? "Código inválido.");
        return await done();
      }
      if (tab === "criar") {
        const r = await authClient.signUp.email({ name: f.name.trim(), email: f.email.trim().toLowerCase(), password: f.password });
        if (r.error) return setError(r.error.message ?? "Não foi possível criar a conta.");
        return await done();
      }
      const r = await authClient.signIn.email({ email: f.email.trim().toLowerCase(), password: f.password });
      if (r.error) return setError(r.error.status === 429 ? "Muitas tentativas. Aguarde um minuto." : "E-mail ou senha inválidos.");
      if ((r.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) return setStep("totp");
      await done();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-8 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <Link href="/entrar" className="flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
            <ArrowLeft size={15} /> Demonstração
          </Link>
        </div>
        <div className="rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h1 className="text-[22px] font-semibold tracking-tight">{step === "totp" ? "Verificação em duas etapas" : tab === "entrar" ? "Entrar na sua conta" : "Criar sua conta"}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{step === "totp" ? "Digite o código de 6 dígitos do seu aplicativo autenticador." : "Seus dados ficam no banco PostgreSQL, isolados por empresa."}</p>
          {enabled === false ? (
            <p className="mt-4 rounded-xl bg-warn-soft p-3 text-[13px] text-warn">Contas reais ainda não estão habilitadas neste ambiente. Use a demonstração enquanto o banco é configurado.</p>
          ) : null}
          {step === "form" ? (
            <Segmented
              className="mt-4"
              value={tab}
              onChange={(v) => {
                setTab(v);
                setError(null);
              }}
              options={[
                { value: "entrar", label: "Entrar" },
                { value: "criar", label: "Criar conta" },
              ]}
            />
          ) : null}
          <form className="mt-4 space-y-4" onSubmit={submit}>
            {step === "totp" ? (
              <Field label="Código">{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
            ) : (
              <>
                {tab === "criar" ? <Field label="Seu nome">{(id) => <Input id={id} autoComplete="name" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field> : null}
                <Field label="E-mail">{(id) => <Input id={id} type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
                <Field label="Senha" hint={tab === "criar" ? "Mínimo de 12 caracteres. Use uma frase longa." : undefined}>
                  {(id) => <Input id={id} type="password" autoComplete={tab === "criar" ? "new-password" : "current-password"} required minLength={12} maxLength={128} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
                </Field>
              </>
            )}
            {error ? (
              <p role="alert" className="rounded-xl bg-danger-soft p-3 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={enabled === false}>
              {step === "totp" ? <ShieldCheck size={17} /> : <KeyRound size={17} />}
              {step === "totp" ? "Verificar" : tab === "entrar" ? "Entrar" : "Criar conta"}
            </Button>
          </form>
        </div>
        <p className="mt-4 flex items-start gap-2 text-[12px] text-subtle">
          <Lock size={13} className="mt-0.5 shrink-0" /> Senhas guardadas com hash forte, sessão em cookie protegido, limite de tentativas e verificação em duas etapas opcional. Recuperação de senha por e-mail será ativada quando houver provedor de e-mail configurado.
        </p>
      </div>
    </div>
  );
}
