import { expect, test, type Page } from "@playwright/test";
import { isMobile } from "./helpers";

/**
 * Modo conta (login real + PostgreSQL). Roda só quando o servidor de teste tem banco:
 * E2E_ACCOUNTS=1 com DATABASE_URL/BETTER_AUTH_SECRET configurados (ver CI).
 */
test.skip(!process.env.E2E_ACCOUNTS, "requer banco PostgreSQL de teste (E2E_ACCOUNTS=1)");

const password = "frase-secreta-de-teste-123";

async function signUp(page: Page, email: string, name: string) {
  await page.goto("/conta");
  await page.getByRole("tab", { name: "Criar conta" }).click();
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).last().click();
  await page.waitForURL("**/conta/empresa", { timeout: 30_000 });
}

test("cadastro, empresa, produto e venda persistem no PostgreSQL entre sessões", async ({ page }, info) => {
  const email = `teste-${info.project.name}-${Date.now()}@exemplo.test`;
  await signUp(page, email, "Titular Teste");
  await page.getByLabel("Nome fantasia").fill("Mercearia Teste");
  await page.getByRole("button", { name: /Começar/ }).click();
  await expect(page.getByText("Vamos começar?")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Conta real (beta)").locator("visible=true").first()).toBeVisible();

  await page.goto("/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  const d = page.getByRole("dialog", { name: "Novo produto" });
  await d.getByLabel("Nome").fill("Café 500 g");
  await d.getByLabel("SKU").fill("CAFE-500");
  await d.getByLabel("Preço de venda").fill("18,90");
  await d.getByLabel("Estoque inicial").fill("10");
  await d.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Café 500 g")).toBeVisible();

  await page.goto("/pdv");
  await page.getByRole("button", { name: "Adicionar Café 500 g" }).click();
  if (isMobile(page)) await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: "Cobrar R$ 18,90" }).click();
  await page.getByRole("dialog", { name: "Pagamento" }).getByRole("button", { name: "Finalizar venda" }).click();
  await expect(page.getByText("COMPROVANTE NÃO FISCAL")).toBeVisible();
  await page.getByRole("button", { name: "Nova venda" }).click();

  // Sai e entra de novo: os dados vêm do banco, não do navegador.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/conta");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).last().click();
  await page.waitForURL("**/painel", { timeout: 30_000 });
  await page.goto("/vendas");
  await page.getByRole("tab", { name: "Todas" }).click();
  await expect(page.getByText("1× Café 500 g")).toBeVisible();
  await page.goto("/produtos");
  await expect(page.getByText("9 un").locator("visible=true").first()).toBeVisible();
});

test("outro usuário não vê a empresa de ninguém e senha errada é recusada", async ({ page }, info) => {
  await signUp(page, `outro-${info.project.name}-${Date.now()}@exemplo.test`, "Outro Titular");
  const session = await page.evaluate(async () => (await fetch("/api/app/session")).json());
  expect(session.tenants).toEqual([]);
  const state = await page.evaluate(async () => (await fetch("/api/app/state")).json());
  expect(state.state).toBeNull();
  const forged = await page.evaluate(async () => (await fetch("/api/app/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "product.create", input: {} }) })).status);
  expect(forged).toBe(409);

  await page.context().clearCookies();
  await page.goto("/conta");
  await page.getByLabel("E-mail").fill("ninguem@exemplo.test");
  await page.getByLabel("Senha").fill("senha-errada-123456");
  await page.getByRole("button", { name: "Entrar" }).last().click();
  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
});

test("API rejeita comando de outra origem (CSRF)", async ({ request }) => {
  const r = await request.post("/api/app/commands", { headers: { origin: "https://atacante.exemplo" }, data: { name: "product.create", input: {} } });
  expect(r.status()).toBe(403);
});
