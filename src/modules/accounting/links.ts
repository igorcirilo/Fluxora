/**
 * Vínculo contador ↔ empresa: autorizado pelo titular, revogável, com escopo explícito.
 * Dados nunca são compartilhados automaticamente entre escritórios.
 */
export type AccountantScope = "read" | "export";

export interface AccountantLink {
  id: string;
  accountantName: string;
  firm: string;
  email: string;
  scopes: AccountantScope[];
  grantedAt: string;
  revokedAt?: string;
  /** Nome da empresa exibido no convite (o convidado ainda não é membro). */
  companyLabel?: string;
  /** Código de uso único: existe só em memória na criação; nunca é lido de volta do banco. */
  inviteCode?: string;
  inviteExpiresAt?: string;
  acceptedAt?: string;
  accountantUserId?: string;
}

export type LinkStatus = "pendente" | "ativo" | "expirado" | "revogado";

export function linkStatus(l: AccountantLink, nowIso: string): LinkStatus {
  if (l.revokedAt) return "revogado";
  if (l.acceptedAt || l.accountantUserId) return "ativo";
  if (l.inviteExpiresAt && l.inviteExpiresAt <= nowIso) return "expirado";
  return l.inviteExpiresAt ? "pendente" : "ativo";
}

/** Código de 8 caracteres (A–F, 0–9) derivado de um identificador aleatório. */
export function inviteCodeFrom(randomId: string): string {
  // Usa os primeiros 8 dígitos hexadecimais da parte aleatória (após o prefixo "xxx_").
  const random = randomId.includes("_") ? randomId.slice(randomId.indexOf("_") + 1) : randomId;
  const hex = random.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length < 8) throw new Error("Identificador sem aleatoriedade suficiente para o código de convite.");
  return hex.slice(0, 8);
}

export function isLinkActive(l: AccountantLink): boolean {
  return !l.revokedAt;
}

export const INVITE_TTL_DAYS = 7;

export function revokeLink(l: AccountantLink, nowIso: string): AccountantLink {
  return l.revokedAt ? l : { ...l, revokedAt: nowIso };
}
