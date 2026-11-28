import { expect, test, type Page } from "@playwright/test";
import { demoSampleNfeXml } from "@/demo/sample-nfe";
import { enterDemo, expectNoHorizontalOverflow } from "./helpers";

const todaySP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function openWith(page: Page, number: number) {
  await page.getByRole("button", { name: "Importar XML da nota" }).click();
  const d = page.getByRole("dialog", { name: "Importar XML da nota de compra" });
  await d.getByLabel("Arquivo XML da NF-e").setInputFiles({ name: `nfe-${number}.xml`, mimeType: "text/xml", buffer: Buffer.from(demoSampleNfeXml(todaySP(), number)) });
  return d;
}

test("importa o XML da NF-e: vincula, cria produto, converte embalagem e lembra o vínculo", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/produtos");
  let d = await openWith(page, 9001);
  await expect(d.getByText("Fornecedor já cadastrado: Distribuidora Exemplo (fictícia)")).toBeVisible();
  await expect(d.getByTestId("nfe-item-1").getByText("pelo código de barras")).toBeVisible();

  // Item 2 não existe no catálogo: criar com preço pela margem.
  await d.getByRole("button", { name: "Aplicar" }).click();
  await expect(d.getByLabel("Preço de venda do item 2")).not.toHaveValue("");

  // Item 3 é pacote com 12: vincular ao produto existente com fator 12.
  const i3 = d.getByTestId("nfe-item-3");
  await i3.getByRole("tab", { name: "Vincular" }).click();
  await i3.getByLabel("Produto do item 3").selectOption({ label: "Caixa presente 12 doces (CXPR-07)" });
  await expect(i3.getByText(/não dá número inteiro/)).toHaveCount(0);
  await i3.getByLabel("Fator do item 3").fill("12");
  await expect(i3.getByText(/Entram\s*36\s*un\./)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await d.getByRole("button", { name: /Dar entrada · R\$ 438,00/ }).click();
  await expect(page.getByText("NF-e 9001 importada: 3 item(ns) no estoque.")).toBeVisible();

  // A mesma nota não entra de novo.
  d = await openWith(page, 9001);
  await expect(d.getByRole("alert")).toContainText("já foi importada");
  await d.getByRole("button", { name: "Cancelar" }).click();

  // Próxima nota do mesmo fornecedor: vínculos lembrados (inclusive o fator).
  d = await openWith(page, 9002);
  await expect(d.getByTestId("nfe-item-2").getByText("lembrado da última nota")).toBeVisible();
  await expect(d.getByLabel("Fator do item 3")).toHaveValue("12");
  await d.getByRole("button", { name: "Trocar arquivo" }).click();
  await d.getByRole("button", { name: "Cancelar" }).click();

  await page.goto("/financeiro?aba=pagar");
  await expect(page.getByText(/NF-e 9001\/1/).first()).toBeVisible();
});
