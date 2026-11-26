import { expect, test } from "@playwright/test";
import { enterDemo } from "./helpers";

test("dados de uma empresa não aparecem na outra", async ({ page }) => {
  await enterDemo(page, "Doceria Aurora");
  await page.goto("/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo produto" });
  await dialog.getByLabel("Nome").fill("Produto exclusivo Aurora");
  await dialog.getByLabel("SKU").fill("EXCL-AUR");
  await dialog.getByLabel("Preço de venda").fill("10,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Produto exclusivo Aurora")).toBeVisible();

  await enterDemo(page, "Studio Bela Forma");
  await page.goto("/produtos");
  await expect(page.getByRole("heading", { name: "Produtos e estoque" })).toBeVisible();
  await expect(page.getByText("Produto exclusivo Aurora")).toHaveCount(0);
});

test("empresa nova mostra onboarding e estados vazios", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: /Começar do zero/ }).click();
  const dialog = page.getByRole("dialog", { name: "Nova empresa (fictícia)" });
  await dialog.getByLabel("Nome fantasia").fill("Ateliê Teste");
  await dialog.getByRole("button", { name: /Criar e entrar/ }).click();
  await expect(page.getByText("Vamos começar?")).toBeVisible({ timeout: 30_000 });
  await page.goto("/vendas");
  await expect(page.getByText("Nenhuma venda encontrada")).toBeVisible();
  await page.goto("/pdv");
  await expect(page.getByText("Nenhum produto cadastrado")).toBeVisible();
  await page.goto("/clientes");
  await expect(page.getByText("Nenhum cliente cadastrado")).toBeVisible();
  await page.goto("/fiscal");
  await expect(page.getByText("Nenhum documento")).toBeVisible();
});
