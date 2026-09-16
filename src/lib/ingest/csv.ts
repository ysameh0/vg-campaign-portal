import Papa from "papaparse";

// Strips a leading UTF-8 BOM (present on Kilele's exports) — papaparse only
// strips it reliably when parsing a File, not a raw string.
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Collapses a header like "Full Name", "full_name", "e_mail" down to a
// delimiter-and-case-insensitive key ("fullname", "email") so the three
// brands' differently-cased, differently-punctuated headers all resolve
// through the same alias map.
export function normalizeHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface ParsedCsv {
  rows: Record<string, string>[];
  headerMap: Record<string, string>; // normalized key -> original header
  delimiter: string;
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(stripBom(text), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h,
  });

  const fields = result.meta.fields ?? [];
  const headerMap: Record<string, string> = {};
  for (const field of fields) {
    headerMap[normalizeHeaderKey(field)] = field;
  }

  return {
    rows: result.data,
    headerMap,
    delimiter: result.meta.delimiter,
  };
}

// Reads a row's value by canonical field name via a set of accepted aliases,
// each normalized the same way the headers were.
export function pick(
  row: Record<string, string>,
  headerMap: Record<string, string>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const original = headerMap[normalizeHeaderKey(alias)];
    if (original !== undefined && row[original] !== undefined && row[original] !== "") {
      return row[original];
    }
  }
  return undefined;
}
