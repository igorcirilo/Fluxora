import { accessKeyCheckDigit } from "@/modules/inventory/nfe-xml";
import { addDays, type BizDate } from "@/modules/finance/dates";

/**
 * Gerador de XML de NF-e FICTÍCIA (sem assinatura, sem validade jurídica) para a demonstração e
 * os testes. O CNPJ 11.222.333/0001-81 é o número de exemplo clássico, não pertence a fornecedor real.
 */
export interface SampleItem {
  code: string;
  ean?: string;
  name: string;
  ncm?: string;
  unit: string;
  qty: string;
  unitPrice: string;
  total: string;
  discount?: string;
  freight?: string;
  ipi?: string;
  icmsSt?: string;
  lots?: { lot: string; qty?: string; fab?: string; val?: string }[];
}

export interface SampleNfe {
  number: number;
  series?: number;
  issuedOn: BizDate;
  supplier?: { cnpj: string; name: string; fantasy?: string; phone?: string };
  items: SampleItem[];
  total: string;
  duplicates?: { n: string; due: BizDate; value: string }[];
  protocolStatus?: string | null;
  model?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sampleAccessKey(n: SampleNfe): string {
  const cnpj = n.supplier?.cnpj ?? "11222333000181";
  const aamm = n.issuedOn.slice(2, 4) + n.issuedOn.slice(5, 7);
  const base = `35${aamm}${cnpj}${n.model ?? "55"}${String(n.series ?? 1).padStart(3, "0")}${String(n.number).padStart(9, "0")}1${String(n.number * 7 + 13).padStart(8, "0").slice(-8)}`;
  return base + accessKeyCheckDigit(base);
}

export function buildSampleNfeXml(n: SampleNfe): string {
  const key = sampleAccessKey(n);
  const sup = n.supplier ?? { cnpj: "11222333000181", name: "Distribuidora Exemplo Ltda (fictícia)", fantasy: "Distribuidora Exemplo", phone: "1133334444" };
  const dets = n.items
    .map((it, i) => {
      const rastro = (it.lots ?? [])
        .map((l) => `<rastro><nLote>${esc(l.lot)}</nLote><qLote>${l.qty ?? it.qty}</qLote>${l.fab ? `<dFab>${l.fab}</dFab>` : ""}${l.val ? `<dVal>${l.val}</dVal>` : ""}</rastro>`)
        .join("");
      const st = it.icmsSt ? `<ICMS><ICMSSN202><orig>0</orig><CSOSN>202</CSOSN><vICMSST>${it.icmsSt}</vICMSST></ICMSSN202></ICMS>` : `<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>`;
      const ipi = it.ipi ? `<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vIPI>${it.ipi}</vIPI></IPITrib></IPI>` : "";
      return `<det nItem="${i + 1}"><prod><cProd>${esc(it.code)}</cProd><cEAN>${it.ean ?? "SEM GTIN"}</cEAN><xProd>${esc(it.name)}</xProd><NCM>${it.ncm ?? "17049020"}</NCM><CFOP>5102</CFOP><uCom>${it.unit}</uCom><qCom>${it.qty}</qCom><vUnCom>${it.unitPrice}</vUnCom><vProd>${it.total}</vProd><cEANTrib>${it.ean ?? "SEM GTIN"}</cEANTrib><uTrib>${it.unit}</uTrib><qTrib>${it.qty}</qTrib><vUnTrib>${it.unitPrice}</vUnTrib>${it.freight ? `<vFrete>${it.freight}</vFrete>` : ""}${it.discount ? `<vDesc>${it.discount}</vDesc>` : ""}<indTot>1</indTot>${rastro}</prod><imposto>${st}${ipi}</imposto></det>`;
    })
    .join("");
  const dup = (n.duplicates ?? []).map((d) => `<dup><nDup>${d.n}</nDup><dVenc>${d.due}</dVenc><vDup>${d.value}</vDup></dup>`).join("");
  const cobr = dup ? `<cobr><fat><nFat>${n.number}</nFat><vOrig>${n.total}</vOrig><vLiq>${n.total}</vLiq></fat>${dup}</cobr>` : "";
  const inf = `<infNFe Id="NFe${key}" versao="4.00"><ide><cUF>35</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>${n.model ?? "55"}</mod><serie>${n.series ?? 1}</serie><nNF>${n.number}</nNF><dhEmi>${n.issuedOn}T09:30:00-03:00</dhEmi><tpNF>1</tpNF><tpAmb>2</tpAmb></ide><emit><CNPJ>${sup.cnpj}</CNPJ><xNome>${esc(sup.name)}</xNome>${sup.fantasy ? `<xFant>${esc(sup.fantasy)}</xFant>` : ""}<enderEmit><xMun>Sao Paulo</xMun><UF>SP</UF>${sup.phone ? `<fone>${sup.phone}</fone>` : ""}</enderEmit><CRT>1</CRT></emit><dest><CNPJ>99888777000161</CNPJ><xNome>Empresa Demonstracao (ficticia)</xNome></dest>${dets}<total><ICMSTot><vProd>${n.total}</vProd><vNF>${n.total}</vNF></ICMSTot></total>${cobr}</infNFe>`;
  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${inf}</NFe>`;
  const status = n.protocolStatus === undefined ? "100" : n.protocolStatus;
  const prot = status === null ? "" : `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>135000000000001</nProt><cStat>${status}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${prot}</nfeProc>`;
}

/** Nota de exemplo da Doceria (demo): casa por código de barras, item novo e embalagem com fator. */
export function demoSampleNfeXml(today: BizDate, number = 7781): string {
  return buildSampleNfeXml({
    number,
    issuedOn: addDays(today, -1),
    items: [
      { code: "DX-BRIG", ean: "7890000000011", name: "BRIGADEIRO GOURMET UN", unit: "UN", qty: "120.0000", unitPrice: "1.6000", total: "192.00", discount: "12.00", lots: [{ lot: "LT-2611", val: addDays(today, 20) }] },
      { code: "DX-EMB4", name: "EMBALAGEM PET P/ 4 DOCES", ncm: "39231090", unit: "UN", qty: "200.0000", unitPrice: "0.4500", total: "90.00" },
      { code: "DX-CXP12", name: "CAIXA PRESENTE KRAFT PCT C/12", ncm: "48191000", unit: "PCT", qty: "3.0000", unitPrice: "54.0000", total: "162.00", freight: "6.00" },
    ],
    total: "438.00",
    duplicates: [
      { n: "001", due: addDays(today, 20), value: "219.00" },
      { n: "002", due: addDays(today, 40), value: "219.00" },
    ],
  });
}
