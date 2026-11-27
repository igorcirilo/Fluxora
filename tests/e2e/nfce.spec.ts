import { expect, test } from "@playwright/test";
import { enterDemo } from "./helpers";

test("preparação da NFC-e SP: IE validada, checklist atualizado e revisão do contador", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/fiscal");
  await expect(page.getByText("NFC-e · São Paulo (piloto)")).toBeVisible();
  await expect(page.getByText("Em preparação")).toBeVisible();
  const ie = page.getByLabel("Inscrição estadual (SP)");
  await ie.fill("110.042.490.115");
  await expect(page.getByText("IE inválida: confira os 12 dígitos.")).toBeVisible();
  await ie.fill("110.042.490.114");
  await page.getByRole("button", { name: "Salvar configuração" }).click();
  await expect(page.getByText("Configuração fiscal salva.")).toBeVisible();
  await expect(page.getByText("IE 110.042.490.114")).toBeVisible();
  await page.getByLabel("Nome do contador responsável").fill("Mônica (fictícia)");
  await page.getByRole("button", { name: "Registrar revisão" }).click();
  await expect(page.getByText(/Revisado por/)).toBeVisible();
  // Provedor continua bloqueado: nunca "pronto para emitir" sem provedor homologado.
  await expect(page.getByText("Pronto para homologação")).toHaveCount(0);
});
