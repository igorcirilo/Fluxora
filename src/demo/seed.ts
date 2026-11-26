import { addDays, parts, todayBiz, type BizDate } from "@/modules/finance/dates";
import { checkout } from "@/modules/sales/checkout";
import { closeSession, drawerTransfer, expectedDrawer, openSession } from "@/modules/sales/cash-session";
import { accountBalance } from "@/modules/finance/cash";
import { addMovement, createTitles, settleTitle } from "@/modules/finance/ops";
import { createProduct, moveStock, type ProductInput } from "@/modules/inventory/ops";
import { ACCOUNT_BANK, ACCOUNT_DRAWER, emptyTenantState, type Ctx, type Tenant, type TenantState } from "@/modules/tenants/state";
import { openCents } from "@/modules/finance/titles";
import { competenceKey } from "@/modules/mei/calendar";
import type { PaymentMethod } from "@/modules/sales/types";

/**
 * DADOS 100% FICTÍCIOS para demonstração. Nomes, telefones e valores são inventados.
 * Gerados de forma determinística (PRNG com semente) usando os MESMOS casos de uso do domínio,
 * o que garante consistência entre vendas, estoque, caixa, recebíveis e limite MEI.
 */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedCtx(prefix: string) {
  let n = 0;
  return (day: BizDate, hour = 12): Ctx => ({
    nowIso: `${day}T${String(hour + 3).padStart(2, "0")}:00:00.000Z`,
    today: day,
    actor: "seed",
    newId: (p) => `${p}_${prefix}${(++n).toString(36)}`,
  });
}

const FIRST_NAMES = ["Marina", "João", "Luíza", "Rafael", "Beatriz", "Caio", "Helena", "Otávio", "Lívia", "Diego", "Sofia", "Tiago", "Clara", "Pedro"];
const LAST_NAMES = ["Albuquerque", "Siqueira", "Moura", "Teixeira", "Paiva", "Rocha", "Campos", "Freitas", "Lacerda", "Barros"];

function customers(rand: () => number, count: number, created: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `cli_${i + 1}`,
    name: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]} (fictício)`,
    phone: `8199${String(1000000 + Math.floor(rand() * 8999999)).slice(0, 7)}`,
    createdAt: created,
  }));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function pickMethod(rand: () => number, weights: [PaymentMethod, number][]): PaymentMethod {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [m, w] of weights) {
    r -= w;
    if (r <= 0) return m;
  }
  return weights[0]![0];
}

interface Profile {
  tenant: Tenant;
  products: (ProductInput & { weight: number })[];
  salesPerDay: [number, number];
  itemsPerSale: [number, number];
  methods: [PaymentMethod, number][];
  monthlyRent: number;
  monthlyWithdrawal: number;
  dasFictitious: number;
  suppliesMonthly: number;
  days: number;
  seed: number;
}

function build(profile: Profile, today: BizDate): TenantState {
  const rand = prng(profile.seed);
  const mk = seedCtx(profile.tenant.id.slice(-1));
  const start = profile.tenant.openedOn > addDays(today, -profile.days) ? profile.tenant.openedOn : addDays(today, -profile.days);
  let s = emptyTenantState(profile.tenant);
  const c0 = mk(start, 8);
  s = { ...s, customers: customers(rand, 12, c0.nowIso), suppliers: [{ id: "for_1", name: "Distribuidora Exemplo (fictícia)", createdAt: c0.nowIso }] };
  s = addMovement(s, { accountId: ACCOUNT_BANK, date: start, direction: "in", amountCents: 350_000, category: "capital_contribution", description: "Aporte inicial do titular" }, c0);
  s = { ...s, movements: [...s.movements, { id: "mov_open_drawer", accountId: ACCOUNT_DRAWER, date: start, direction: "in", amountCents: 20_000, category: "opening_balance", description: "Saldo inicial da gaveta" }] };
  for (const p of profile.products) s = createProduct(s, p, c0);
  const productIds = s.products.map((p, i) => ({ id: p.id, weight: profile.products[i]!.weight, track: p.trackStock }));

  let day = start;
  let lastMonth = -1;
  while (day <= today) {
    const { month, day: dom } = parts(day);
    const c = mk(day, 8);
    if (month !== lastMonth) {
      lastMonth = month;
      // Despesas fixas e reposição mensais.
      if (profile.monthlyRent) s = addMovement(s, { accountId: ACCOUNT_BANK, date: day, direction: "out", amountCents: profile.monthlyRent, category: "expense", description: "Aluguel do ponto" }, c);
      s = addMovement(s, { accountId: ACCOUNT_BANK, date: day, direction: "out", amountCents: 18_000 + Math.floor(rand() * 9_000), category: "expense", description: "Energia e internet" }, c);
      s = createTitles(s, { kind: "payable", description: "Compra de insumos", counterpartyId: "for_1", competenceDate: day, firstDueDate: addDays(day, 15), totalCents: profile.suppliesMonthly, installments: 2, category: "Fornecedor" }, c);
      for (const p of s.products.filter((x) => x.trackStock)) s = moveStock(s, { productId: p.id, type: "purchase", quantity: 60 + Math.floor(rand() * 40), note: "Reposição mensal" }, c);
    }
    if (dom === 5 && day !== start) s = addMovement(s, { accountId: ACCOUNT_BANK, date: day, direction: "out", amountCents: profile.monthlyWithdrawal, category: "owner_withdrawal", description: "Retirada do titular" }, c);
    if (dom === 18) {
      const prev = month === 1 ? competenceKey(parts(day).year - 1, 12) : competenceKey(parts(day).year, month - 1);
      if (`${prev}-01` >= profile.tenant.openedOn.slice(0, 7) + "-01" && day < today) {
        s = addMovement(s, { accountId: ACCOUNT_BANK, date: day, direction: "out", amountCents: profile.dasFictitious, category: "expense", description: `DAS MEI ${prev} (valor fictício)` }, c);
        s = { ...s, dasPayments: [...s.dasPayments, { competence: prev, amountCents: profile.dasFictitious, paidOn: day, proofNote: "Comprovante fictício (demo)" }] };
      }
    }
    // Liquidações de títulos vencidos (operadora de cartão e fornecedores); fiado parcialmente.
    for (const t of s.titles) {
      if (openCents(t) === 0 || t.dueDate > day) continue;
      if (t.category === "Cartão" || t.category === "Fornecedor") {
        if (t.category === "Fornecedor" && t.dueDate > addDays(today, -3)) continue;
        s = settleTitle(s, { titleId: t.id, amountCents: openCents(t), date: day, accountId: ACCOUNT_BANK }, c);
        if (t.category === "Cartão") s = addMovement(s, { accountId: ACCOUNT_BANK, date: day, direction: "out", amountCents: Math.max(1, Math.round(t.amountCents * 0.0299)), category: "fee", description: "Taxa da maquininha (fictícia)" }, c);
      } else if (t.category === "Fiado" && rand() < 0.04 && t.dueDate < addDays(today, -20)) {
        const amount = rand() < 0.5 ? openCents(t) : Math.max(1, Math.floor(openCents(t) / 2));
        s = settleTitle(s, { titleId: t.id, amountCents: amount, date: day, accountId: ACCOUNT_DRAWER }, c);
      }
    }
    const weekdayClosed = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
    if (!weekdayClosed) {
      s = openSession(s, Math.max(0, accountBalance(s.movements, ACCOUNT_DRAWER)), mk(day, 8));
      const n = profile.salesPerDay[0] + Math.floor(rand() * (profile.salesPerDay[1] - profile.salesPerDay[0] + 1));
      for (let i = 0; i < n; i++) {
        const ci = mk(day, 9 + Math.floor((i / Math.max(1, n)) * 9));
        const lines = profile.itemsPerSale[0] + Math.floor(rand() * (profile.itemsPerSale[1] - profile.itemsPerSale[0] + 1));
        const items: { productId: string; quantity: number }[] = [];
        for (let k = 0; k < lines; k++) {
          const total = productIds.reduce((a, p) => a + p.weight, 0);
          let r = rand() * total;
          const chosen = productIds.find((p) => (r -= p.weight) <= 0) ?? productIds[0]!;
          const existing = items.find((x) => x.productId === chosen.id);
          if (existing) existing.quantity += 1;
          else items.push({ productId: chosen.id, quantity: chosen.track ? 1 + Math.floor(rand() * 2) : 1 });
        }
        const subtotal = items.reduce((a, it) => a + s.products.find((p) => p.id === it.productId)!.priceCents * it.quantity, 0);
        const discount = rand() < 0.1 ? Math.floor(subtotal * 0.05) : 0;
        const total = subtotal - discount;
        const method = pickMethod(rand, profile.methods);
        const customerId = method === "fiado" || rand() < 0.35 ? pick(rand, s.customers).id : undefined;
        const tendered = method === "dinheiro" ? Math.ceil(total / 1000) * 1000 + (rand() < 0.3 ? 1000 : 0) : undefined;
        try {
          s = checkout(s, { idempotencyKey: `seed-${profile.seed}-${day}-${i}`, items, discountCents: discount, payments: [{ method, amountCents: total }], cashTenderedCents: tendered, customerId, date: day }, ci).state;
        } catch {
          // Estoque insuficiente no dia: a venda simplesmente não ocorre (como na vida real).
        }
      }
      if (day !== today) {
        const sess = s.cashSessions.find((x) => !x.closedAt)!;
        const cd = mk(day, 19);
        const exp = expectedDrawer(s, sess.id);
        if (exp > 30_000) s = drawerTransfer(s, "sangria", exp - 20_000, cd, "Sangria de fim de dia");
        const exp2 = expectedDrawer(s, sess.id);
        s = closeSession(s, exp2 - (exp2 > 500 && rand() < 0.08 ? 200 : 0), cd);
      }
    }
    day = addDays(day, 1);
  }
  // Uma conta a pagar futura e uma vencida para demonstrar alertas.
  const cf = mk(today, 9);
  s = createTitles(s, { kind: "payable", description: "Manutenção de equipamento", counterpartyId: "for_1", competenceDate: today, firstDueDate: addDays(today, 6), totalCents: 42_000, installments: 1, category: "Serviços" }, cf);
  s = createTitles(s, { kind: "payable", description: "Embalagens personalizadas", counterpartyId: "for_1", competenceDate: addDays(today, -20), firstDueDate: addDays(today, -2), totalCents: 18_900, installments: 1, category: "Fornecedor" }, cf);
  s = {
    ...s,
    accountantLinks: [{ id: "lnk_1", accountantName: "Mônica Exemplo (fictícia)", firm: "Escritório Contábil Exemplo", email: "contato@contabil.exemplo", scopes: ["read", "export"], grantedAt: `${start}T12:00:00.000Z` }],
    audit: s.audit.slice(-300),
  };
  return s;
}

export const DEMO_TENANT_A = "tnt_demo_a";
export const DEMO_TENANT_B = "tnt_demo_b";

export function seedDoceria(today: BizDate = todayBiz()): TenantState {
  const { year } = parts(today);
  return build(
    {
      tenant: { id: DEMO_TENANT_A, name: "Aurora Doces Finos MEI (fictícia)", tradeName: "Doceria Aurora", openedOn: `${year - 2}-03-04`, regime: "mei-geral", segment: "comercio", city: "Recife", uf: "PE", allowNegativeStock: false, isDemo: true },
      products: [
        { name: "Brigadeiro gourmet", sku: "BRIG-01", barcode: "7890000000011", category: "Doces", unit: "un", priceCents: 450, costCents: 160, minStock: 30, trackStock: true, initialStock: 120, weight: 8 },
        { name: "Bolo de pote ninho com morango", sku: "BPOT-02", barcode: "7890000000028", category: "Bolos", unit: "un", priceCents: 1400, costCents: 520, minStock: 10, trackStock: true, initialStock: 40, weight: 6 },
        { name: "Torta de limão (fatia)", sku: "TORT-03", category: "Tortas", unit: "un", priceCents: 1200, costCents: 410, minStock: 8, trackStock: true, initialStock: 30, weight: 4 },
        { name: "Bolo inteiro chocolate 1,5 kg", sku: "BOLO-04", category: "Bolos", unit: "un", priceCents: 8900, costCents: 3200, minStock: 2, trackStock: true, initialStock: 6, weight: 1.2 },
        { name: "Café espresso", sku: "CAFE-05", category: "Bebidas", unit: "un", priceCents: 600, costCents: 140, minStock: 0, trackStock: false, weight: 5 },
        { name: "Cappuccino cremoso", sku: "CAPP-06", category: "Bebidas", unit: "un", priceCents: 1100, costCents: 320, minStock: 0, trackStock: false, weight: 3 },
        { name: "Caixa presente 12 doces", sku: "CXPR-07", barcode: "7890000000073", category: "Presentes", unit: "cx", priceCents: 5400, costCents: 2100, minStock: 4, trackStock: true, initialStock: 15, weight: 1.5 },
        { name: "Encomenda festa (serviço)", sku: "ENCO-08", category: "Encomendas", unit: "un", priceCents: 25000, costCents: 9000, minStock: 0, trackStock: false, weight: 0.25 },
      ],
      salesPerDay: [4, 8],
      itemsPerSale: [1, 3],
      methods: [["pix", 46], ["dinheiro", 18], ["debito", 16], ["credito", 15], ["fiado", 5]],
      monthlyRent: 95_000,
      monthlyWithdrawal: 180_000,
      dasFictitious: 8_190,
      suppliesMonthly: 160_000,
      days: 320,
      seed: 20261126,
    },
    today,
  );
}

export function seedStudio(today: BizDate = todayBiz()): TenantState {
  return build(
    {
      tenant: { id: DEMO_TENANT_B, name: "Bela Forma Estética MEI (fictícia)", tradeName: "Studio Bela Forma", openedOn: addDays(today, -170).slice(0, 8) + "10", regime: "mei-geral", segment: "servicos", city: "Olinda", uf: "PE", allowNegativeStock: false, isDemo: true },
      products: [
        { name: "Design de sobrancelhas", sku: "SERV-01", category: "Serviços", unit: "h", priceCents: 6000, costCents: 800, minStock: 0, trackStock: false, weight: 5 },
        { name: "Limpeza de pele", sku: "SERV-02", category: "Serviços", unit: "h", priceCents: 16500, costCents: 2500, minStock: 0, trackStock: false, weight: 3 },
        { name: "Massagem relaxante 50 min", sku: "SERV-03", category: "Serviços", unit: "h", priceCents: 14500, costCents: 1500, minStock: 0, trackStock: false, weight: 2.5 },
        { name: "Manicure e pedicure", sku: "SERV-04", category: "Serviços", unit: "h", priceCents: 7000, costCents: 900, minStock: 0, trackStock: false, weight: 4 },
        { name: "Sérum facial 30 ml", sku: "PROD-05", barcode: "7890000000509", category: "Produtos", unit: "un", priceCents: 8900, costCents: 4100, minStock: 5, trackStock: true, initialStock: 20, weight: 1 },
        { name: "Kit spa para casa", sku: "PROD-06", category: "Produtos", unit: "cx", priceCents: 12900, costCents: 6200, minStock: 3, trackStock: true, initialStock: 8, weight: 0.5 },
      ],
      salesPerDay: [1, 3],
      itemsPerSale: [1, 2],
      methods: [["pix", 55], ["credito", 20], ["debito", 15], ["dinheiro", 8], ["fiado", 2]],
      monthlyRent: 70_000,
      monthlyWithdrawal: 150_000,
      dasFictitious: 8_590,
      suppliesMonthly: 60_000,
      days: 170,
      seed: 777,
    },
    today,
  );
}

export function blankTenant(params: { id: string; tradeName: string; openedOn: BizDate; segment: Tenant["segment"] }): TenantState {
  return emptyTenantState({ id: params.id, name: `${params.tradeName} (fictícia)`, tradeName: params.tradeName, openedOn: params.openedOn, regime: "mei-geral", segment: params.segment, city: "", uf: "", allowNegativeStock: false, isDemo: true });
}
