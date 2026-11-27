import { DomainError } from "@/lib/errors";
import type { Product } from "@/modules/inventory/stock";
import type { Sale } from "@/modules/sales/types";

/**
 * Preparação da NFC-e (piloto SP). Aqui só há VALIDAÇÃO DE FORMATO e checklist:
 * os valores (NCM, CFOP, CSOSN, CRT, obrigatoriedade) são definidos pelo contador.
 * A emissão continua desabilitada até haver provedor homologado e credenciais.
 */
export interface ProductFiscal {
  ncm?: string; // 8 dígitos
  cfop?: string; // 4 dígitos
  csosn?: string; // 3 dígitos (Simples Nacional)
  origem?: string; // 0–8
  cest?: string; // 7 dígitos, quando aplicável
}

export type FiscalEnvironment = "homologacao" | "producao";

export interface FiscalSettings {
  uf: string;
  ie?: string; // inscrição estadual (somente dígitos)
  environment: FiscalEnvironment;
  series: number;
  nextNumber: number;
  crt?: string; // código de regime tributário — confirmar com o contador
  accreditationConfirmedAt?: string; // credenciamento NFC-e confirmado na SEFAZ
  certificateConfigured: boolean; // certificado A1 instalado no provedor (o arquivo NUNCA fica no banco do app)
  cscConfigured: boolean; // CSC/token configurado no provedor (segredo fora do app)
  accountantReview?: { name: string; at: string; note?: string };
}

export const DEFAULT_FISCAL_SETTINGS: FiscalSettings = { uf: "SP", environment: "homologacao", series: 1, nextNumber: 1, certificateConfigured: false, cscConfigured: false };

export const CSOSN_OPTIONS: { value: string; label: string }[] = [
  { value: "102", label: "102 – Tributada pelo Simples sem permissão de crédito" },
  { value: "103", label: "103 – Isenção do ICMS no Simples para faixa de receita" },
  { value: "300", label: "300 – Imune" },
  { value: "400", label: "400 – Não tributada" },
  { value: "500", label: "500 – ICMS cobrado anteriormente por substituição tributária" },
  { value: "900", label: "900 – Outros" },
];

export const ORIGEM_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "0 – Nacional" },
  { value: "1", label: "1 – Estrangeira, importação direta" },
  { value: "2", label: "2 – Estrangeira, adquirida no mercado interno" },
  { value: "3", label: "3 – Nacional, conteúdo de importação > 40% e ≤ 70%" },
  { value: "4", label: "4 – Nacional, processos produtivos básicos" },
  { value: "5", label: "5 – Nacional, conteúdo de importação ≤ 40%" },
  { value: "6", label: "6 – Estrangeira, importação direta sem similar nacional (CAMEX)" },
  { value: "7", label: "7 – Estrangeira, mercado interno sem similar nacional (CAMEX)" },
  { value: "8", label: "8 – Nacional, conteúdo de importação > 70%" },
];

const digits = (s: string) => s.replace(/\D/g, "");

export function normalizeProductFiscal(f: ProductFiscal | undefined): ProductFiscal | undefined {
  if (!f) return undefined;
  const out: ProductFiscal = {};
  if (f.ncm?.trim()) {
    const v = digits(f.ncm);
    if (!/^\d{8}$/.test(v)) throw new DomainError("VALIDATION_ERROR", "NCM deve ter 8 dígitos.");
    out.ncm = v;
  }
  if (f.cfop?.trim()) {
    const v = digits(f.cfop);
    if (!/^[1-7]\d{3}$/.test(v)) throw new DomainError("VALIDATION_ERROR", "CFOP deve ter 4 dígitos.");
    out.cfop = v;
  }
  if (f.csosn?.trim()) {
    if (!CSOSN_OPTIONS.some((o) => o.value === f.csosn)) throw new DomainError("VALIDATION_ERROR", "CSOSN inválido.");
    out.csosn = f.csosn;
  }
  if (f.origem?.trim()) {
    if (!/^[0-8]$/.test(f.origem)) throw new DomainError("VALIDATION_ERROR", "Origem inválida.");
    out.origem = f.origem;
  }
  if (f.cest?.trim()) {
    const v = digits(f.cest);
    if (!/^\d{7}$/.test(v)) throw new DomainError("VALIDATION_ERROR", "CEST deve ter 7 dígitos.");
    out.cest = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Inscrição estadual de SP (comércio/indústria, 12 dígitos) com os dois dígitos verificadores
 * (9º e 12º). Inscrições de produtor rural (P…) não são aceitas aqui.
 */
export function isValidIeSP(input: string): boolean {
  const d = digits(input);
  if (!/^\d{12}$/.test(d)) return false;
  const n = d.split("").map(Number);
  const w1 = [1, 3, 4, 5, 6, 7, 8, 10];
  const dv1 = (w1.reduce((s, w, i) => s + w * n[i]!, 0) % 11) % 10;
  if (dv1 !== n[8]) return false;
  const w2 = [3, 2, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv2 = (w2.reduce((s, w, i) => s + w * n[i]!, 0) % 11) % 10;
  return dv2 === n[11];
}

export function formatIeSP(ie?: string): string {
  const d = digits(ie ?? "");
  return d.length === 12 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}.${d.slice(9)}` : d;
}

export function normalizeFiscalSettings(input: Partial<FiscalSettings>, current: FiscalSettings): FiscalSettings {
  const next: FiscalSettings = { ...current, ...input };
  if (next.uf !== "SP") throw new DomainError("VALIDATION_ERROR", "O piloto de NFC-e está preparado apenas para SP.");
  if (next.ie) {
    next.ie = digits(next.ie);
    if (!isValidIeSP(next.ie)) throw new DomainError("VALIDATION_ERROR", "Inscrição estadual de SP inválida (confira os dígitos).");
  } else delete next.ie;
  if (!Number.isInteger(next.series) || next.series < 1 || next.series > 999) throw new DomainError("VALIDATION_ERROR", "Série entre 1 e 999.");
  if (!Number.isInteger(next.nextNumber) || next.nextNumber < 1 || next.nextNumber > 999_999_999) throw new DomainError("VALIDATION_ERROR", "Número inicial inválido.");
  if (next.crt && !/^[1-4]$/.test(next.crt)) throw new DomainError("VALIDATION_ERROR", "CRT inválido.");
  if (next.environment === "producao" && !next.accountantReview) throw new DomainError("VALIDATION_ERROR", "Produção só após revisão do contador e homologação.");
  return next;
}

export type CheckStatus = "ok" | "pendente" | "bloqueado";

export interface ReadinessItem {
  id: string;
  label: string;
  detail: string;
  status: CheckStatus;
  owner: "empresa" | "contador" | "fluxora";
}

/** Checklist de prontidão para emitir NFC-e no piloto. Emissão só com TODOS os itens ok. */
export function nfceReadiness(s: FiscalSettings, products: readonly Product[], providerConfigured: boolean): { items: ReadinessItem[]; ready: boolean; productsMissing: Product[] } {
  const sellable = products.filter((p) => p.active && p.trackStock);
  const productsMissing = sellable.filter((p) => !p.fiscal?.ncm || !p.fiscal?.cfop || !p.fiscal?.csosn || p.fiscal?.origem === undefined);
  const items: ReadinessItem[] = [
    { id: "obrigacao", label: "Obrigatoriedade confirmada", detail: "Contador confirma se o MEI precisa (ou quer) emitir NFC-e nas vendas ao consumidor.", status: s.accountantReview ? "ok" : "pendente", owner: "contador" },
    { id: "ie", label: "Inscrição estadual (SP)", detail: s.ie ? `IE ${formatIeSP(s.ie)}` : "Informe a IE da empresa.", status: s.ie ? "ok" : "pendente", owner: "empresa" },
    { id: "credenciamento", label: "Credenciamento NFC-e na SEFAZ-SP", detail: s.accreditationConfirmedAt ? "Confirmado." : "Solicitar no portal da SEFAZ-SP e marcar quando aprovado.", status: s.accreditationConfirmedAt ? "ok" : "pendente", owner: "empresa" },
    { id: "certificado", label: "Certificado digital A1", detail: "Instalado no provedor de emissão. O arquivo nunca fica no Fluxora.", status: s.certificateConfigured ? "ok" : "pendente", owner: "empresa" },
    { id: "csc", label: "CSC (código de segurança do contribuinte)", detail: "Gerado na SEFAZ-SP e configurado no provedor.", status: s.cscConfigured ? "ok" : "pendente", owner: "empresa" },
    { id: "produtos", label: "Dados fiscais dos produtos", detail: productsMissing.length ? `${productsMissing.length} de ${sellable.length} produto(s) sem NCM/CFOP/CSOSN/origem.` : `${sellable.length} produto(s) completos.`, status: productsMissing.length || !sellable.length ? "pendente" : "ok", owner: "contador" },
    { id: "provedor", label: "Provedor de emissão homologado", detail: providerConfigured ? "Configurado." : "Ainda não contratado/configurado. A emissão fica desabilitada.", status: providerConfigured ? "ok" : "bloqueado", owner: "fluxora" },
    { id: "homologacao", label: "Testes em homologação", detail: s.environment === "producao" ? "Concluídos (produção ativa)." : "Emitir notas de teste no ambiente de homologação antes da produção.", status: s.environment === "producao" ? "ok" : "pendente", owner: "fluxora" },
  ];
  return { items, ready: items.every((i) => i.status === "ok"), productsMissing };
}

/** Pendências de uma venda específica para virar NFC-e (sem emitir nada). */
export function nfceSaleIssues(sale: Sale, products: readonly Product[], s: FiscalSettings): string[] {
  const issues: string[] = [];
  if (!s.ie) issues.push("Empresa sem inscrição estadual.");
  for (const it of sale.items) {
    const p = products.find((x) => x.id === it.productId);
    if (!p) continue;
    if (!p.fiscal?.ncm) issues.push(`${p.name}: sem NCM.`);
    if (!p.fiscal?.cfop) issues.push(`${p.name}: sem CFOP.`);
    if (!p.fiscal?.csosn) issues.push(`${p.name}: sem CSOSN.`);
  }
  return issues;
}
