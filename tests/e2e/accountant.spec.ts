import { expect, test, type Page } from "@playwright/test";

test("demo: contadora vê as empresas autorizadas e não consegue alterar dados", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: /Mônica, contadora/ }).click();
  await page.waitForURL("**/contador", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Painel do contador" })).toBeVisible();
  await expect(page.getByText("Doceria Aurora").locator("visible=true").first()).toBeVisible();
  await expect(page.getByText("Studio Bela Forma").locator("visible=true").first()).toBeVisible();
  await page.getByRole("button", { name: /Abrir \(somente leitura\)/ }).first().click();
  await page.waitForURL("**/painel");
  await expect(page.getByText(/Somente leitura: você está vendo/)).toBeVisible();
  await page.goto("/contador");
  await expect(page.getByRole("button", { name: /Exportar dados/ }).first()).toBeEnabled();
  await page.goto("/painel");
  await expect(page.getByRole("link", { name: "PDV" })).toHaveCount(0);
  await page.goto("/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  const d = page.getByRole("dialog", { name: "Novo produto" });
  await d.getByLabel("Nome").fill("Tentativa");
  await d.getByLabel("SKU").fill("TENT-01");
  await d.getByLabel("Preço de venda").fill("1,00");
  await d.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Acesso de contador é somente leitura.")).toBeVisible();
});

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

test.describe("conta real", () => {
  test.skip(!process.env.E2E_ACCOUNTS, "requer banco PostgreSQL de teste (E2E_ACCOUNTS=1)");

  test("titular convida, contadora aceita com código, titular revoga", async ({ browser }, info) => {
    const stamp = `${info.project.name}-${Date.now()}`;
    const ownerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    await signUp(owner, `titular-${stamp}@exemplo.test`, "Titular");
    await owner.getByLabel("Nome fantasia").fill("Empório Teste");
    await owner.getByRole("button", { name: /Começar/ }).click();
    await expect(owner.getByText("Vamos começar?")).toBeVisible({ timeout: 30_000 });
    await owner.goto("/configuracoes");
    await owner.getByRole("button", { name: "Convidar contador" }).click();
    const g = owner.getByRole("dialog", { name: "Convidar contador" });
    const accountantEmail = `contadora-${stamp}@contabil.test`;
    await g.getByLabel("Nome do contador").fill("Mônica Teste");
    await g.getByLabel("Escritório").fill("Escritório Teste");
    await g.getByLabel("E-mail do contador").fill(accountantEmail);
    await g.getByRole("button", { name: "Gerar convite" }).click();
    const created = owner.getByRole("dialog", { name: "Convite criado" });
    const code = (await created.locator(".font-mono").first().textContent())!.trim();
    expect(code).toMatch(/^[A-F0-9]{8}$/);
    await created.getByRole("button", { name: "Concluir" }).click();
    await expect(owner.getByText("Aguardando aceite")).toBeVisible();

    const accCtx = await browser.newContext();
    const acc = await accCtx.newPage();
    await signUp(acc, accountantEmail, "Mônica Teste");
    await expect(acc.getByText("Você foi convidado(a) como contador(a)")).toBeVisible();
    await acc.getByLabel(/Código do convite/).fill("00000000");
    await acc.getByRole("button", { name: "Aceitar" }).click();
    await expect(acc.getByText(/Código incorreto/)).toBeVisible();
    await acc.getByLabel(/Código do convite/).fill(code);
    await acc.getByRole("button", { name: "Aceitar" }).click();
    await acc.waitForURL("**/contador", { timeout: 30_000 });
    await expect(acc.getByText("Empório Teste").locator("visible=true").first()).toBeVisible();

    await owner.reload();
    await expect(owner.getByText("Ativo", { exact: true })).toBeVisible();
    await owner.getByRole("button", { name: "Revogar" }).click();
    await expect(owner.getByText("Acesso do contador revogado.")).toBeVisible();

    const after = await acc.evaluate(async () => (await fetch("/api/accountant/clients")).json());
    expect(after.clients).toEqual([]);
    await ownerCtx.close();
    await accCtx.close();
  });
});
