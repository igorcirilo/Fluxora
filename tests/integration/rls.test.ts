import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate } from "../../scripts/migrate.mjs";
import { withTenant, withUser } from "@/lib/db/tenant-tx";

/**
 * Testes com PostgreSQL REAL. Requer TEST_PG_ADMIN_URL (superusuário de um servidor descartável).
 * Cria um banco temporário, papéis owner/runtime, aplica migrations e valida isolamento A × B.
 */
const ADMIN = process.env.TEST_PG_ADMIN_URL;
const dbName = `fluxora_test_${Date.now().toString(36)}`;

function urlFor(user: string, password: string, db: string) {
  const u = new URL(ADMIN!);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

describe.skipIf(!ADMIN)("PostgreSQL RLS e isolamento entre tenants", () => {
  let admin: pg.Client;
  let appPool: pg.Pool;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    for (const [role, extra] of [["fluxora_owner", "CREATEDB"], ["fluxora_app", ""]] as const) {
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (!exists.rowCount) await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'test' NOSUPERUSER NOBYPASSRLS ${extra}`);
    }
    await admin.query(`CREATE DATABASE ${dbName} OWNER fluxora_owner`);
    const owner = new pg.Client({ connectionString: urlFor("fluxora_owner", "test", dbName) });
    await owner.connect();
    await migrate(owner, undefined, () => undefined);
    // Usuários são geridos pelo serviço de autenticação (owner nesta preparação).
    const users = await owner.query("INSERT INTO app.users (email, name) VALUES ('a@exemplo.test','Usuário A'), ('b@exemplo.test','Usuário B') RETURNING id, email");
    ids.userA = users.rows.find((r) => r.email.startsWith("a"))!.id;
    ids.userB = users.rows.find((r) => r.email.startsWith("b"))!.id;
    await owner.end();
    appPool = new pg.Pool({ connectionString: urlFor("fluxora_app", "test", dbName), max: 1 }); // max 1: força reuso da MESMA conexão
    ids.tenantA = await withUser(appPool, ids.userA!, async (c) => (await c.query("SELECT app.create_tenant('Empresa A (teste)', 'A', '2025-01-01', 'comercio') AS id")).rows[0].id);
    ids.tenantB = await withUser(appPool, ids.userB!, async (c) => (await c.query("SELECT app.create_tenant('Empresa B (teste)', 'B', '2025-01-01', 'servicos') AS id")).rows[0].id);
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    }
  });

  const A = () => ({ userId: ids.userA!, tenantId: ids.tenantA! });
  const B = () => ({ userId: ids.userB!, tenantId: ids.tenantB! });

  it("papel de runtime não é superusuário, não ignora RLS e não é dono das tabelas", async () => {
    const r = await appPool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await appPool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'app' AND tableowner = current_user");
    expect(owned.rows[0].n).toBe(0);
  });

  it("A grava e lê os próprios dados; B não enxerga os dados de A", async () => {
    await withTenant(appPool, A(), (c) => c.query("INSERT INTO app.products (tenant_id, sku, name, unit, price_cents) VALUES ($1, 'BOLO-01', 'Bolo', 'un', 1200)", [ids.tenantA]));
    const a = await withTenant(appPool, A(), (c) => c.query("SELECT sku FROM app.products"));
    expect(a.rows.map((r) => r.sku)).toEqual(["BOLO-01"]);
    const b = await withTenant(appPool, B(), (c) => c.query("SELECT sku FROM app.products"));
    expect(b.rowCount).toBe(0);
    const tenantsSeenByB = await withTenant(appPool, B(), (c) => c.query("SELECT id FROM app.tenants"));
    expect(tenantsSeenByB.rows.map((r) => r.id)).toEqual([ids.tenantB]);
  });

  it("usuário B não consegue abrir contexto no tenant A (membership verificada antes do set_config)", async () => {
    await expect(withTenant(appPool, { userId: ids.userB!, tenantId: ids.tenantA! }, async () => 1)).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
  });

  it("escrita com tenant_id de outra empresa é bloqueada por WITH CHECK", async () => {
    await expect(withTenant(appPool, B(), (c) => c.query("INSERT INTO app.products (tenant_id, sku, name, unit, price_cents) VALUES ($1, 'HACK-01', 'x', 'un', 1)", [ids.tenantA]))).rejects.toThrow(/row-level security/);
  });

  it("mesmo com set_config forjado sem membership, a política nega (defesa em profundidade)", async () => {
    const c = await appPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)", [ids.userB, ids.tenantA]);
      const r = await c.query("SELECT count(*)::int AS n FROM app.products");
      expect(r.rows[0].n).toBe(0);
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("contexto não vaza entre transações na mesma conexão do pool (negar por padrão)", async () => {
    await withTenant(appPool, A(), (c) => c.query("SELECT 1"));
    const after = await appPool.query("SELECT current_setting('app.tenant_id', true) AS t, (SELECT count(*)::int FROM app.products) AS n");
    expect(after.rows[0].t ?? "").toBe("");
    expect(after.rows[0].n).toBe(0);
  });

  it("FK composta impede referência a registro de outro tenant (IDs aninhados)", async () => {
    const productA = await withTenant(appPool, A(), async (c) => (await c.query("SELECT id FROM app.products LIMIT 1")).rows[0].id as string);
    await expect(
      withTenant(appPool, B(), async (c) => {
        const s = await c.query("INSERT INTO app.sales (tenant_id, number, idempotency_key, sale_date, subtotal_cents, total_cents) VALUES ($1, 1, 'k-b-1', '2026-11-26', 1200, 1200) RETURNING id", [ids.tenantB]);
        await c.query("INSERT INTO app.sale_items (tenant_id, sale_id, product_id, name, quantity, unit_price_cents, unit_cost_cents, total_cents) VALUES ($1, $2, $3, 'x', 1, 1200, 0, 1200)", [ids.tenantB, s.rows[0].id, productA]);
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it("chave idempotente única por tenant/operação: repetição não duplica venda", async () => {
    const insert = (c: pg.PoolClient) => c.query("INSERT INTO app.sales (tenant_id, number, idempotency_key, sale_date, subtotal_cents, total_cents) VALUES ($1, (SELECT coalesce(max(number),0)+1 FROM app.sales), 'same-key', '2026-11-26', 500, 500)", [ids.tenantA]);
    await withTenant(appPool, A(), insert);
    await expect(withTenant(appPool, A(), insert)).rejects.toThrow(/duplicate key/);
    // A mesma chave em OUTRO tenant é independente.
    await withTenant(appPool, B(), (c) => c.query("INSERT INTO app.sales (tenant_id, number, idempotency_key, sale_date, subtotal_cents, total_cents) VALUES ($1, 99, 'same-key', '2026-11-26', 500, 500)", [ids.tenantB]));
  });

  it("lançamentos de caixa são imutáveis e liquidação não excede o título", async () => {
    await withTenant(appPool, A(), async (c) => {
      const acc = (await c.query("SELECT id FROM app.accounts WHERE kind = 'bank'")).rows[0].id;
      const le = await c.query("INSERT INTO app.ledger_entries (tenant_id, account_id, entry_date, direction, amount_cents, category, description) VALUES ($1, $2, '2026-11-26', 'in', 1000, 'receivable_settlement', 'x') RETURNING id", [ids.tenantA, acc]);
      const t = await c.query("INSERT INTO app.titles (tenant_id, kind, description, competence_date, due_date, amount_cents) VALUES ($1, 'receivable', 'fiado', '2026-11-01', '2026-12-01', 1500) RETURNING id", [ids.tenantA]);
      await c.query("INSERT INTO app.settlements (tenant_id, title_id, settled_on, amount_cents, ledger_entry_id) VALUES ($1, $2, '2026-11-26', 1000, $3)", [ids.tenantA, t.rows[0].id, le.rows[0].id]);
      await c.query("SAVEPOINT s1");
      await expect(c.query("INSERT INTO app.settlements (tenant_id, title_id, settled_on, amount_cents, ledger_entry_id) VALUES ($1, $2, '2026-11-26', 501, $3)", [ids.tenantA, t.rows[0].id, le.rows[0].id])).rejects.toThrow(/excede/);
      await c.query("ROLLBACK TO SAVEPOINT s1");
    });
    await expect(withTenant(appPool, A(), (c) => c.query("UPDATE app.ledger_entries SET amount_cents = 1"))).rejects.toThrow(/permission denied|imutável/);
    await expect(withTenant(appPool, A(), (c) => c.query("DELETE FROM app.ledger_entries"))).rejects.toThrow(/permission denied|imutável/);
  });

  it("documento fiscal nunca fica 'autorizado' sem protocolo", async () => {
    await expect(withTenant(appPool, A(), (c) => c.query("INSERT INTO app.fiscal_documents (tenant_id, type, status, idempotency_key) VALUES ($1, 'nfse', 'authorized', 'f-1')", [ids.tenantA]))).rejects.toThrow(/check constraint/);
  });

  it("exportação (consulta ampla) retorna apenas dados do tenant da sessão", async () => {
    const exportOf = (ctx: { userId: string; tenantId: string }) =>
      withTenant(appPool, ctx, async (c) => {
        const tables = ["products", "sales", "accounts", "ledger_entries", "titles"];
        const out: Record<string, string[]> = {};
        for (const t of tables) out[t] = (await c.query(`SELECT DISTINCT tenant_id::text FROM app.${t}`)).rows.map((r) => r.tenant_id);
        return out;
      });
    const a = await exportOf(A());
    for (const owners of Object.values(a)) expect(owners.every((x) => x === ids.tenantA)).toBe(true);
    const b = await exportOf(B());
    for (const owners of Object.values(b)) expect(owners.every((x) => x === ids.tenantB)).toBe(true);
  });

  it("sem contexto de usuário, create_tenant é recusado", async () => {
    await expect(appPool.query("SELECT app.create_tenant('X','X','2025-01-01','comercio')")).rejects.toThrow(/não autenticado/);
  });

  it("migrations são idempotentes e detectam alteração (checksum)", async () => {
    const owner = new pg.Client({ connectionString: urlFor("fluxora_owner", "test", dbName) });
    await owner.connect();
    try {
      expect(await migrate(owner, undefined, () => undefined)).toEqual([]);
      await owner.query("UPDATE public.schema_migrations SET checksum = 'x' WHERE name = '0001_core.sql'");
      await expect(migrate(owner, undefined, () => undefined)).rejects.toThrow(/alterada/);
    } finally {
      await owner.end();
    }
  });
});
