import { XMLParser } from "fast-xml-parser";
import { DomainError } from "@/lib/errors";
import type { Cents } from "@/modules/finance/money";
import type { BizDate } from "@/modules/finance/dates";

/**
 * Leitura do XML da NF-e (modelo 55) recebida do fornecedor, para entrada de mercadoria.
 * Puro e determinístico: roda na prévia (navegador) e de novo no servidor, que nunca confia
 * nos valores calculados pelo cliente. Sem rede, sem entidades externas, com limite de tamanho.
 * Não valida a assinatura digital: o valor jurídico continua sendo o do documento na SEFAZ.
 */
export const NFE_XML_MAX_CHARS = 1_000_000;
export const NFE_MAX_ITEMS = 200;

export interface NfeLot {
  lot: string;
  /** quantidade do lote × 10⁴ (mesma escala de `quantity4`), quando informada */
  quantity4?: number;
  manufacturedOn?: BizDate;
  expiresOn?: BizDate;
}

export interface NfeItem {
  n: number;
  code: string;
  barcode?: string;
  name: string;
  ncm?: string;
  cest?: string;
  cfop?: string;
  unit: string;
  /** quantidade comercial × 10⁴ (a NF-e admite até 4 casas decimais) */
  quantity4: number;
  grossCents: Cents;
  discountCents: Cents;
  /** frete + seguro + outras despesas + ICMS-ST + FCP-ST + IPI rateados no item */
  extraCents: Cents;
  /** custo de aquisição do item = bruto − desconto + acréscimos */
  totalCostCents: Cents;
  lots: NfeLot[];
}

export interface NfeDuplicate {
  number: string;
  dueDate: BizDate;
  amountCents: Cents;
}

export interface NfeDocument {
  accessKey: string;
  series: string;
  number: string;
  issuedOn: BizDate;
  supplier: { document: string; name: string; tradeName?: string; phone?: string; uf?: string };
  recipient?: { document?: string; name?: string };
  items: NfeItem[];
  productsCents: Cents;
  totalCents: Cents;
  duplicates: NfeDuplicate[];
  /** true = protocolo de autorização presente (cStat 100/150); null = XML sem protocolo */
  authorized: boolean | null;
}

const fail = (msg: string): never => {
  throw new DomainError("VALIDATION_ERROR", msg);
};

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
export function accessKeyCheckDigit(first43: string): number {
  let sum = 0;
  let w = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = 11 - (sum % 11);
  return r >= 10 ? 0 : r;
}

export function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

export function formatAccessKey(key: string): string {
  return key.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Decimal da NF-e ("123.4567") → inteiro na escala 10^scale, sem passar por ponto flutuante. */
export function decimalToScaled(raw: unknown, scale: number, label: string): number {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  const m = /^(\d{1,15})(?:\.(\d{1,10}))?$/.exec(s);
  if (!m) return fail(`Valor inválido em ${label}.`);
  const frac = (m[2] ?? "").padEnd(scale + 1, "0");
  let v = Number(m[1]) * 10 ** scale + Number(frac.slice(0, scale) || "0");
  if (Number(frac[scale]) >= 5) v += 1; // arredondamento meio-para-cima no dígito seguinte
  if (!Number.isSafeInteger(v)) return fail(`Valor muito grande em ${label}.`);
  return v;
}

const cents = (raw: unknown, label: string) => decimalToScaled(raw, 2, label);
const optCents = (raw: unknown, label: string) => (raw === undefined || raw === "" ? 0 : cents(raw, label));

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return str((v as Record<string, unknown>)["#text"]);
  return "";
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): unknown[] {
  return v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v];
}

function bizDate(raw: unknown, label: string): BizDate {
  const s = str(raw);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return fail(`Data inválida em ${label}.`);
  const d = new Date(`${m[1]}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1]) return fail(`Data inválida em ${label}.`);
  return m[1] as BizDate;
}

const optDate = (raw: unknown, label: string) => (str(raw) ? bizDate(raw, label) : undefined);

/** Soma, nos grupos de imposto do item, os campos que compõem o custo (ST, FCP-ST, IPI). */
function taxExtras(imposto: Record<string, unknown>, n: number): number {
  let total = 0;
  const icms = obj(imposto.ICMS);
  for (const group of Object.values(icms)) {
    const g = obj(group);
    total += optCents(str(g.vICMSST) || undefined, `ICMS-ST do item ${n}`);
    total += optCents(str(g.vFCPST) || undefined, `FCP-ST do item ${n}`);
  }
  const ipi = obj(obj(imposto.IPI).IPITrib);
  total += optCents(str(ipi.vIPI) || undefined, `IPI do item ${n}`);
  return total;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  trimValues: true,
  maxNestedTags: 64,
  isArray: (name) => name === "det" || name === "dup" || name === "rastro",
});

/** Lê o XML (nfeProc ou NFe) e devolve os dados da nota. Lança DomainError com mensagem para o usuário. */
export function parseNfeXml(xml: string): NfeDocument {
  if (typeof xml !== "string" || !xml.trim()) return fail("Envie o arquivo XML da nota fiscal.");
  if (xml.length > NFE_XML_MAX_CHARS) return fail("Arquivo muito grande para uma NF-e (limite de 1 MB).");
  // Sem DTD/entidades: elimina XXE e expansão de entidades ("billion laughs").
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return fail("XML com declaração DOCTYPE não é aceito.");
  let root: Record<string, unknown>;
  try {
    root = obj(parser.parse(xml.replace(/^﻿/, "")));
  } catch {
    return fail("Não foi possível ler o arquivo. Confira se é o XML da NF-e (não o PDF/DANFE).");
  }
  const proc = obj(root.nfeProc);
  const nfe = obj(proc.NFe ?? root.NFe);
  const inf = obj(nfe.infNFe);
  if (!Object.keys(inf).length) return fail("Este arquivo não parece ser o XML de uma NF-e. Use o XML enviado pelo fornecedor (não o PDF/DANFE).");

  const ide = obj(inf.ide);
  const model = str(ide.mod);
  if (model === "65") return fail("Este XML é de uma NFC-e (cupom ao consumidor), não de nota de compra.");
  if (model !== "55") return fail("Modelo de documento não suportado: use o XML de uma NF-e (modelo 55).");

  const accessKey = str(inf["@_Id"]).replace(/^NFe/, "");
  if (!isValidAccessKey(accessKey)) return fail("Chave de acesso da nota inválida.");
  const infProt = obj(obj(proc.protNFe).infProt);
  const protKey = str(infProt.chNFe);
  if (protKey && protKey !== accessKey) return fail("O protocolo de autorização não corresponde a esta nota.");
  const cStat = str(infProt.cStat);
  let authorized: boolean | null = null;
  if (cStat) {
    if (cStat !== "100" && cStat !== "150") return fail(`Nota não autorizada pela SEFAZ (situação ${cStat}). Não registre entrada de nota cancelada ou denegada.`);
    authorized = true;
  }

  const emit = obj(inf.emit);
  const supplierDoc = (str(emit.CNPJ) || str(emit.CPF)).replace(/\D/g, "");
  if (supplierDoc.length !== 14 && supplierDoc.length !== 11) return fail("CNPJ/CPF do emitente ausente ou inválido.");
  const supplierName = str(emit.xNome);
  if (!supplierName) return fail("Nome do emitente ausente.");
  const ender = obj(emit.enderEmit);
  const phone = str(ender.fone).replace(/\D/g, "");
  const dest = obj(inf.dest);

  const dets = list(inf.det);
  if (!dets.length) return fail("A nota não tem itens.");
  if (dets.length > NFE_MAX_ITEMS) return fail(`A nota tem ${dets.length} itens; o limite por importação é ${NFE_MAX_ITEMS}.`);
  const items: NfeItem[] = dets.map((raw, idx) => {
    const det = obj(raw);
    const n = Number(str(det["@_nItem"])) || idx + 1;
    const prod = obj(det.prod);
    const name = str(prod.xProd);
    if (!name) return fail(`Item ${n} sem descrição.`);
    const ean = str(prod.cEAN);
    const quantity4 = decimalToScaled(str(prod.qCom), 4, `quantidade do item ${n}`);
    if (quantity4 <= 0) return fail(`Quantidade do item ${n} deve ser positiva.`);
    const grossCents = cents(str(prod.vProd), `valor do item ${n}`);
    const discountCents = optCents(str(prod.vDesc) || undefined, `desconto do item ${n}`);
    const extraCents =
      optCents(str(prod.vFrete) || undefined, `frete do item ${n}`) +
      optCents(str(prod.vSeg) || undefined, `seguro do item ${n}`) +
      optCents(str(prod.vOutro) || undefined, `outras despesas do item ${n}`) +
      taxExtras(obj(det.imposto), n);
    const totalCostCents = grossCents - discountCents + extraCents;
    if (totalCostCents < 0) return fail(`Desconto maior que o valor no item ${n}.`);
    const lots: NfeLot[] = list(prod.rastro).map((r) => {
      const ro = obj(r);
      const q = str(ro.qLote);
      return {
        lot: str(ro.nLote).slice(0, 40),
        quantity4: q ? decimalToScaled(q, 4, `quantidade do lote do item ${n}`) : undefined,
        manufacturedOn: optDate(ro.dFab, `fabricação do lote do item ${n}`),
        expiresOn: optDate(ro.dVal, `validade do lote do item ${n}`),
      };
    });
    const ncm = str(prod.NCM).replace(/\D/g, "");
    const cest = str(prod.CEST).replace(/\D/g, "");
    return {
      n,
      code: str(prod.cProd).slice(0, 60) || `ITEM-${n}`,
      barcode: /^\d{8,14}$/.test(ean) ? ean : undefined,
      name: name.slice(0, 120),
      ncm: ncm.length === 8 ? ncm : undefined,
      cest: cest.length === 7 ? cest : undefined,
      cfop: /^\d{4}$/.test(str(prod.CFOP)) ? str(prod.CFOP) : undefined,
      unit: str(prod.uCom).slice(0, 6).toUpperCase() || "UN",
      quantity4,
      grossCents,
      discountCents,
      extraCents,
      totalCostCents,
      lots: lots.filter((l) => l.lot || l.expiresOn),
    };
  });

  const tot = obj(obj(inf.total).ICMSTot);
  const totalCents = cents(str(tot.vNF), "valor total da nota");
  const productsCents = optCents(str(tot.vProd) || undefined, "valor dos produtos");
  const duplicates: NfeDuplicate[] = list(obj(inf.cobr).dup).map((raw, i) => {
    const d = obj(raw);
    return { number: str(d.nDup).slice(0, 20) || String(i + 1).padStart(3, "0"), dueDate: bizDate(d.dVenc, `vencimento da duplicata ${i + 1}`), amountCents: cents(str(d.vDup), `valor da duplicata ${i + 1}`) };
  });
  if (duplicates.length > 48) return fail("A nota tem mais de 48 duplicatas.");
  if (duplicates.some((d) => d.amountCents <= 0)) return fail("Duplicata com valor zerado.");

  return {
    accessKey,
    series: str(ide.serie) || "1",
    number: str(ide.nNF),
    issuedOn: bizDate(ide.dhEmi || ide.dEmi, "data de emissão"),
    supplier: { document: supplierDoc, name: supplierName.slice(0, 120), tradeName: str(emit.xFant).slice(0, 120) || undefined, phone: phone.length >= 10 && phone.length <= 13 ? phone : undefined, uf: str(ender.UF) || undefined },
    recipient: Object.keys(dest).length ? { document: (str(dest.CNPJ) || str(dest.CPF)).replace(/\D/g, "") || undefined, name: str(dest.xNome) || undefined } : undefined,
    items,
    productsCents,
    totalCents,
    duplicates,
    authorized,
  };
}

/** Quantidade em unidades de estoque = quantidade da nota × fator; null se não der número inteiro. */
export function stockQuantity(quantity4: number, factor: number): number | null {
  const scaled = quantity4 * factor;
  return scaled % 10_000 === 0 ? scaled / 10_000 : null;
}

export function formatQuantity4(q4: number): string {
  const int = Math.floor(q4 / 10_000);
  const frac = String(q4 % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${int.toLocaleString("pt-BR")},${frac}` : int.toLocaleString("pt-BR");
}

export function formatDocument(doc: string): string {
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return doc;
}
