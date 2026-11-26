import { expect, type Page } from "@playwright/test";

export async function enterDemo(page: Page, company: "Doceria Aurora" | "Studio Bela Forma" = "Doceria Aurora") {
  await page.goto("/entrar");
  await page.getByRole("button", { name: new RegExp(company) }).click();
  await page.waitForURL("**/painel", { timeout: 30_000 });
  await expect(page.getByText("Limite do MEI").first()).toBeVisible({ timeout: 30_000 });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "sem rolagem horizontal").toBeLessThanOrEqual(0);
}

export function isMobile(page: Page) {
  return (page.viewportSize()?.width ?? 1200) < 1024;
}
