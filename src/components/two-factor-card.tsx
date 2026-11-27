"use client";
import { useState } from "react";
import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { authClient } from "@/client/auth-client";
import { Button, Card, CardBody, CardHeader, Field, Input, useToast } from "@/components/ui";

/** Verificação em duas etapas (TOTP). Obrigatória para administradores da plataforma; opcional para titulares. */
export function TwoFactorCard() {
  const toast = useToast();
  const session = authClient.useSession();
  const enabled = !!(session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ qr: string; uri: string; backup: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const r = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (r.error || !r.data || r.data.method !== "totp") return toast("error", r.error?.message ?? "Senha incorreta.");
    const qr = await QRCode.toDataURL(r.data.totpURI, { margin: 1, width: 200 });
    setSetup({ qr, uri: r.data.totpURI, backup: r.data.backupCodes });
    setPassword("");
  };
  const confirm = async () => {
    setBusy(true);
    const r = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (r.error) return toast("error", "Código inválido.");
    toast("success", "Verificação em duas etapas ativada.");
    setSetup(null);
    void session.refetch();
  };
  const disable = async () => {
    setBusy(true);
    const r = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (r.error) return toast("error", r.error.message ?? "Senha incorreta.");
    toast("success", "Verificação em duas etapas desativada.");
    setPassword("");
    void session.refetch();
  };

  return (
    <Card>
      <CardHeader title="Segurança da conta" subtitle={enabled ? "Verificação em duas etapas ativa" : "Proteja o acesso com um aplicativo autenticador"} action={<ShieldCheck size={18} className={enabled ? "text-accent" : "text-subtle"} />} />
      <CardBody className="space-y-3">
        {setup ? (
          <>
            <p className="text-[13px] text-muted">Escaneie no Google Authenticator, Authy ou similar e digite o código gerado.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code para o aplicativo autenticador" width={160} height={160} className="rounded-xl border border-line bg-white p-2" />
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">Códigos de recuperação (guarde em local seguro)</summary>
              <p className="mt-2 font-mono break-all">{setup.backup.join("  ")}</p>
            </details>
            <div className="flex gap-2">
              <Input aria-label="Código do autenticador" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
              <Button loading={busy} onClick={() => void confirm()}>
                Confirmar
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label="Senha atual">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <Button variant={enabled ? "outline" : "primary"} className="w-full" disabled={password.length < 12} loading={busy} onClick={() => void (enabled ? disable() : start())}>
              {enabled ? "Desativar verificação em duas etapas" : "Ativar verificação em duas etapas"}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
