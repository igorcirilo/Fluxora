"use client";
export type ThemePref = "light" | "dark" | "system";

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem("fluxora.theme") as ThemePref) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem("fluxora.theme", pref);
  } catch {
    /* preferência só nesta aba */
  }
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
