import { DomainError } from "@/lib/errors";

/**
 * Contrato de emissão fiscal (NFS-e, NFC-e, NF-e em etapas independentes).
 * Um documento só é "authorized" com protocolo retornado pelo autorizador.
 * Timeout ⇒ consultar `status` antes de qualquer reenvio (nunca reenviar às cegas).
 * Comprovante interno de venda NUNCA equivale a nota fiscal.
 */
export type FiscalDocType = "nfse" | "nfce" | "nfe";
export type FiscalStatus = "draft" | "queued" | "submitted" | "authorized" | "rejected" | "cancelled" | "unknown";

export const FISCAL_STATUS_LABEL: Record<FiscalStatus, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  submitted: "Enviado",
  authorized: "Autorizado",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
  unknown: "Situação desconhecida",
};

export const FISCAL_DOC_LABEL: Record<FiscalDocType, string> = { nfse: "NFS-e", nfce: "NFC-e", nfe: "NF-e" };

const TRANSITIONS: Record<FiscalStatus, readonly FiscalStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["submitted", "rejected", "unknown"],
  submitted: ["authorized", "rejected", "unknown"],
  unknown: ["authorized", "rejected", "submitted"], // resolvido somente por consulta
  authorized: ["cancelled"],
  rejected: ["draft"],
  cancelled: [],
};

export function canTransition(from: FiscalStatus, to: FiscalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface FiscalTransition {
  to: FiscalStatus;
  protocol?: string;
  at: string;
  message?: string;
}

export function applyTransition(current: FiscalStatus, t: FiscalTransition): FiscalStatus {
  if (!canTransition(current, t.to)) throw new DomainError("VALIDATION_ERROR", `Transição fiscal inválida: ${current} → ${t.to}.`);
  if (t.to === "authorized" && !t.protocol) throw new DomainError("VALIDATION_ERROR", "Autorização exige protocolo.");
  return t.to;
}

export interface FiscalIssueRequest {
  tenantId: string;
  idempotencyKey: string;
  type: FiscalDocType;
  saleId?: string;
}

export interface FiscalProviderResult {
  providerRef: string;
  status: FiscalStatus;
  protocol?: string;
}

export interface FiscalProvider {
  readonly id: string;
  readonly configured: boolean;
  issue(req: FiscalIssueRequest): Promise<FiscalProviderResult>;
  status(providerRef: string): Promise<FiscalProviderResult>;
  cancel(providerRef: string, reason: string): Promise<FiscalProviderResult>;
  fetchXml(providerRef: string): Promise<string>;
}

/** Provedor padrão sem credenciais: recurso desabilitado, erro configurável, nunca sucesso simulado. */
export class DisabledFiscalProvider implements FiscalProvider {
  readonly id = "disabled";
  readonly configured = false;
  private fail(): never {
    throw new DomainError("FISCAL_PROVIDER_NOT_CONFIGURED", "Emissão fiscal não configurada. Requer provedor homologado e credenciais.");
  }
  async issue(): Promise<FiscalProviderResult> {
    this.fail();
  }
  async status(): Promise<FiscalProviderResult> {
    this.fail();
  }
  async cancel(): Promise<FiscalProviderResult> {
    this.fail();
  }
  async fetchXml(): Promise<string> {
    this.fail();
  }
}

export function getFiscalProvider(name: string | undefined = process.env.FISCAL_PROVIDER): FiscalProvider {
  switch (name ?? "disabled") {
    default:
      return new DisabledFiscalProvider();
  }
}

export interface FiscalDocument {
  id: string;
  type: FiscalDocType;
  saleId?: string;
  status: FiscalStatus;
  protocol?: string;
  createdAt: string;
  events: FiscalTransition[];
}
