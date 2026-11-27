import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "@/lib/db/pool";
import { authOptions } from "./options";

function build() {
  const base = authOptions(getPool(), {
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  return betterAuth({ ...base, plugins: [...(base.plugins ?? []), nextCookies()] });
}

let instance: ReturnType<typeof build> | null = null;

/** Instância preguiçosa: o modo demonstração (sem DATABASE_URL) não inicializa autenticação. */
export function getAuth() {
  if (!instance) {
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error("BETTER_AUTH_SECRET ausente ou curto (mínimo 32 caracteres).");
    instance = build();
  }
  return instance;
}

export async function getSessionUser(headers: Headers): Promise<{ id: string; name: string; email: string } | null> {
  const s = await getAuth().api.getSession({ headers });
  return s ? { id: s.user.id, name: s.user.name, email: s.user.email } : null;
}
