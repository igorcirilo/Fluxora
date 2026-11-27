"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Moon, MoreHorizontal, Sun, FlaskConical, ArrowLeftRight, ShieldCheck } from "lucide-react";
import { useAppStatus, useTenant, getStore, getAccountStore } from "@/demo/use-demo";
import { cn, Skeleton, ToastProvider } from "@/components/ui";
import { MOBILE_PRIMARY, NAV } from "./nav";
import { Logo } from "./logo";
import { applyTheme } from "./theme";

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const app = useAppStatus();
  const t = useTenant();
  const router = useRouter();
  const path = usePathname();
  const [moreAt, setMoreAt] = useState<string | null>(null);
  const more = moreAt === path;
  const setMore = (v: boolean) => setMoreAt(v ? path : null);

  useEffect(() => {
    if (app.status === "redirect-demo" || app.status === "disabled") router.replace("/entrar");
    else if (app.status === "anon") router.replace("/conta");
    else if (app.status === "no-tenant") router.replace("/conta/empresa");
  }, [app.status, router]);

  if (!t) {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-64 border-r border-line bg-elevated lg:block" />
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-64" />
          {app.status === "error" ? (
            <div className="mx-auto max-w-sm rounded-2xl border border-line bg-surface p-4 text-center text-sm">
              <p className="text-danger">Não foi possível carregar seus dados.</p>
              <button className="mt-2 font-medium text-brand" onClick={() => void getAccountStore()?.refresh()}>
                Tentar novamente
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">{app.mode === "conta" ? "Carregando sua empresa…" : "Preparando dados fictícios de demonstração…"}</p>
          )}
        </div>
      </div>
    );
  }

  const toggleTheme = () => applyTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  const demo = t.mode === "demo";
  const logout = async () => {
    if (demo) {
      getStore()?.logout();
      router.replace("/entrar");
    } else {
      await getAccountStore()?.signOut();
      router.replace("/conta");
    }
  };
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <ToastProvider>
      <div className="flex min-h-dvh">
        {/* Sidebar desktop */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-elevated lg:flex">
          <div className="flex h-16 items-center px-5">
            <Link href="/painel" aria-label="Fluxora — painel">
              <Logo />
            </Link>
          </div>
          <div className="mx-3 mb-3 rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand to-accent text-[13px] font-semibold text-white">
                {initials(t.state.tenant.tradeName)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold">{t.state.tenant.tradeName}</div>
                <div className="truncate text-[12px] text-muted">
                  {t.state.tenant.segment === "servicos" ? "Serviços" : t.state.tenant.segment === "misto" ? "Comércio e serviços" : "Comércio"} · MEI
                </div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Principal">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition",
                  active(href) ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Icon size={18} strokeWidth={active(href) ? 2.3 : 2} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="space-y-2 border-t border-line p-3">
            {demo ? (
              <div className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-[12px] leading-snug text-warn">
                <FlaskConical size={15} className="mt-px shrink-0" />
                <span>
                  <b>Modo demonstração.</b> Dados fictícios salvos só neste navegador.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl bg-accent-soft p-3 text-[12px] leading-snug text-accent">
                <ShieldCheck size={15} className="mt-px shrink-0" />
                <span>
                  <b>Conta real (beta).</b> Dados salvos no servidor, isolados por empresa.
                </span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1 truncate px-2 text-[12.5px] text-muted">{t.userName}</div>
              <button onClick={toggleTheme} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Alternar tema">
                <Sun size={16} className="hidden dark:block" />
                <Moon size={16} className="dark:hidden" />
              </button>
              <button onClick={() => void logout()} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Sair da demonstração">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topo mobile */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-elevated/85 px-4 backdrop-blur-xl lg:hidden">
            <Logo withText={false} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold leading-tight">{t.state.tenant.tradeName}</div>
              {demo ? (
                <div className="flex items-center gap-1 text-[11px] font-medium text-warn">
                  <FlaskConical size={11} /> Demonstração · dados fictícios
                </div>
              ) : (
                <div className="flex items-center gap-1 text-[11px] font-medium text-accent">
                  <ShieldCheck size={11} /> Conta real (beta)
                </div>
              )}
            </div>
            <button onClick={toggleTheme} className="rounded-lg p-2 text-muted" aria-label="Alternar tema">
              <Sun size={18} className="hidden dark:block" />
              <Moon size={18} className="dark:hidden" />
            </button>
          </header>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-10">{children}</main>
        </div>

        {/* Navegação inferior mobile */}
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-elevated/90 backdrop-blur-xl lg:hidden" aria-label="Navegação inferior">
          <div className="grid grid-cols-5">
            {NAV.filter((n) => MOBILE_PRIMARY.includes(n.href)).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
                className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(href) ? "text-brand" : "text-muted")}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition", active(href) && "bg-brand-soft")}>
                  <Icon size={19} strokeWidth={active(href) ? 2.4 : 2} />
                </span>
                {label}
              </Link>
            ))}
            <button
              onClick={() => setMore(true)}
              className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", NAV.some((n) => !MOBILE_PRIMARY.includes(n.href) && active(n.href)) ? "text-brand" : "text-muted")}
              aria-haspopup="dialog"
            >
              <span className="grid h-7 w-12 place-items-center rounded-full">
                <MoreHorizontal size={19} />
              </span>
              Mais
            </button>
          </div>
        </nav>

        {more ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Mais opções">
            <div className="animate-fade absolute inset-0 bg-black/45" onClick={() => setMore(false)} />
            <div className="animate-sheet pb-safe absolute inset-x-0 bottom-0 rounded-t-3xl border border-line bg-elevated p-4">
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
              <div className="grid grid-cols-3 gap-2">
                {NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href)).map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-2xl border border-line p-3 text-[12.5px] font-medium",
                      active(href) ? "border-brand/40 bg-brand-soft text-brand" : "bg-surface",
                    )}
                  >
                    <Icon size={22} />
                    {label}
                  </Link>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href={demo ? "/entrar" : "/conta/empresa"} className="flex items-center justify-center gap-2 rounded-xl bg-surface-2 py-3 text-[13px] font-medium">
                  <ArrowLeftRight size={16} /> {demo ? "Trocar empresa" : "Nova empresa"}
                </Link>
                <button onClick={() => void logout()} className="flex items-center justify-center gap-2 rounded-xl bg-surface-2 py-3 text-[13px] font-medium">
                  <LogOut size={16} /> Sair
                </button>
              </div>
              <p className="mt-3 text-center text-[11.5px] text-muted">{t.userName} · {demo ? "modo demonstração" : "conta real"}</p>
            </div>
          </div>
        ) : null}
      </div>
    </ToastProvider>
  );
}
