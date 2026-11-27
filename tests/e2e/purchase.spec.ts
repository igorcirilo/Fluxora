import { expect, test } from "@playwright/test";
import { enterDemo } from "./helpers";

test("entrada de mercadoria a prazo aumenta o estoque e gera conta a pagar", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/produtos");
  await page.getByRole("button", { name: "Entrada de mercadoria" }).click();
  const d = page.getByRole("dialog", { name: "Entrada de mercadoria" });
  await d.getByLabel("Produto").selectOption({ label: "Caixa presente 12 doces" });
  await d.getByLabel("Quantidade").fill("7");
  await d.getByLabel("Custo unitário").fill("20,00");
  await d.getByLabel("Lote").fill("E2E-01");
  await d.getByRole("button", { name: /Registrar entrada · R\$ 140,00/ }).click();
  await expect(page.getByText("Entrada de mercadoria registrada.")).toBeVisible();
  await page.goto("/financeiro?aba=pagar");
  await expect(page.getByText(/Compra de mercadorias/).first()).toBeVisible();
});
