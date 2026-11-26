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
}

export function isLinkActive(l: AccountantLink): boolean {
  return !l.revokedAt;
}

export function revokeLink(l: AccountantLink, nowIso: string): AccountantLink {
  return l.revokedAt ? l : { ...l, revokedAt: nowIso };
}
