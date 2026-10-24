/**
 * Geração de CSV compatível com Excel em português:
 *  - UTF-8 com BOM (acentos aparecem corretamente);
 *  - separador ";" (padrão do Excel com vírgula decimal);
 *  - proteção contra "CSV injection" (células iniciadas por = + - @ são neutralizadas).
 */
function cell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
