import { expect, test } from "@playwright/test";
import { enterDemo, expectNoHorizontalOverflow } from "./helpers";

const PAGES = [
  { path: "/painel", heading: /Bom dia|Boa tarde|Boa noite/ },
  { path: "/pdv", heading: "Ponto de venda" },
  { path: "/vendas", heading: "Vendas" },
  { path: "/produtos", heading: "Produtos e estoque" },
  { path: "/clientes", heading: "Clientes" },
  { path: "/financeiro", heading: "Financeiro" },
  { path: "/meu-mei", heading: "Meu MEI" },
  { path: "/fiscal", heading: "Fiscal" },
  { path: "/configuracoes", heading: "Configurações" },
];

test("entrada sinaliza demonstração com dados fictícios", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByText("Ambiente de demonstração.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("todas as telas carregam sem erros e sem rolagem horizontal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await enterDemo(page);
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("KPIs exibem definição e período", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Definição de Receita bruta" }).click();
  await expect(page.getByRole("tooltip")).toContainText("competência");
});

test("sem sessão, telas internas redirecionam para a entrada", async ({ page }) => {
  await page.goto("/financeiro");
  await expect(page).toHaveURL(/\/entrar$/, { timeout: 30_000 });
});
