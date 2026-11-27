import type { BetterAuthOptions } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import type { Pool } from "pg";

/**
 * Configuração compartilhada do Better Auth (servidor e geração de schema).
 * - Senhas: hash scrypt da biblioteca (padrão Better Auth), mínimo 12 caracteres.
 * - Cookies HttpOnly + SameSite=Lax; Secure em produção (HTTPS).
 * - CSRF: validação de Origin/Fetch-Metadata da biblioteca + trustedOrigins.
 * - Rate limit persistido no banco (funciona em serverless).
 * - MFA (TOTP) via plugin two-factor.
 * Tabelas ficam no schema `app` com prefixo `auth_` (search_path do pool).
 */
export function authOptions(pool: Pool, env: { secret?: string; baseURL?: string; trustedOrigins?: string[] } = {}): BetterAuthOptions {
  // Multiplicador só para ambientes de teste automatizado (muitos cadastros do mesmo IP). Padrão: 1.
  const k = Math.max(1, Math.min(50, Number(process.env.AUTH_RATE_LIMIT_MULTIPLIER ?? 1) || 1));
  return {
    appName: "Fluxora",
    database: pool,
    secret: env.secret,
    baseURL: env.baseURL,
    trustedOrigins: env.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Recuperação por token de uso único exige provedor de e-mail. Sem ele, o envio é recusado (nunca "simulado").
      sendResetPassword: async () => {
        throw new Error("Envio de e-mail não configurado.");
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, modelName: "auth_session" },
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 60 * k,
      customRules: { "/sign-in/email": { window: 60, max: 5 * k }, "/sign-up/email": { window: 60, max: 3 * k }, "/two-factor/*": { window: 60, max: 5 * k } },
    },
    advanced: { database: { generateId: "uuid" }, useSecureCookies: process.env.NODE_ENV === "production", cookiePrefix: "fluxora" },
    plugins: [twoFactor({ issuer: "Fluxora", schema: { twoFactor: { modelName: "auth_two_factor" } } })],
    telemetry: { enabled: false },
  };
}
