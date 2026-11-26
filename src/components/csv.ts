/** Exportação CSV (sem lock-in). Separador ';' e BOM para abrir corretamente no Excel pt-BR. */
export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    // Neutraliza injeção de fórmulas em planilhas.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\n");
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  downloadText(filename, toCsv(rows), "text/csv;charset=utf-8");
}

export function downloadText(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
