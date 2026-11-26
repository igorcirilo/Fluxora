import { expect, test } from "@playwright/test";
import { enterDemo, isMobile } from "./helpers";

test("venda no PDV com dinheiro e troco gera comprovante não fiscal e aparece no histórico", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/pdv");
  await page.getByRole("button", { name: "Adicionar Bolo de pote ninho com morango" }).click();
  await page.getByRole("button", { name: "Adicionar Bolo de pote ninho com morango" }).click();
  if (isMobile(page)) await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: "Cobrar R$ 28,00" }).click();
  const dialog = page.getByRole("dialog", { name: "Pagamento" });
  await dialog.getByRole("button", { name: "Dinheiro" }).click();
  await dialog.getByLabel("Valor recebido em dinheiro").fill("50,00");
  await expect(dialog.getByText("R$ 22,00")).toBeVisible();
  await dialog.getByRole("button", { name: "Finalizar venda" }).click();
  const receipt = page.getByRole("dialog", { name: "Venda concluída" });
  await expect(receipt.getByText("COMPROVANTE NÃO FISCAL")).toBeVisible();
  const number = (await receipt.getByText(/Venda #\d+ registrada/).textContent())!.match(/#(\d+)/)![1];
  await receipt.getByRole("button", { name: "Nova venda" }).click();
  await page.goto("/vendas");
  await page.getByRole("searchbox").fill(number!);
  await expect(page.getByRole("button", { name: new RegExp(`#${number}`) }).first()).toBeVisible();
});

test("fiado exige cliente antes de finalizar", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/pdv");
  await page.getByRole("button", { name: "Adicionar Torta de limão (fatia)" }).click();
  if (isMobile(page)) await page.getByRole("button", { name: /Ver carrinho/ }).click();
  await page.getByRole("button", { name: /^Cobrar/ }).click();
  const dialog = page.getByRole("dialog", { name: "Pagamento" });
  await dialog.getByRole("button", { name: "Fiado" }).click();
  await expect(dialog.getByText("Selecione o cliente para venda fiado.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Finalizar venda" })).toBeDisabled();
});

test("emissão fiscal indisponível nunca simula sucesso", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/vendas");
  await page.getByRole("button", { name: /^#\d+/ }).first().click();
  await page.getByRole("button", { name: "Rascunho fiscal" }).click();
  await page.goto("/fiscal");
  await page.getByRole("button", { name: "Enviar" }).first().click();
  await expect(page.getByText(/Emissão fiscal não configurada/)).toBeVisible();
  await expect(page.getByText("Autorizado", { exact: true }).locator("visible=true")).toHaveCount(1); // só a legenda do ciclo
});
