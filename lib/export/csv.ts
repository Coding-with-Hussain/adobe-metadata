/**
 * RFC 4180 CSV writer with spreadsheet formula-injection protection.
 *
 * - Fields are quoted when they contain a comma, double quote, CR or LF, or
 *   leading/trailing whitespace; embedded quotes are doubled.
 * - Records are separated by CRLF.
 * - Text is emitted as-is (UTF-16 string); encode as UTF-8 when saving.
 *
 * Formula protection (on by default): a cell whose first non-whitespace
 * character is `=`, `+`, `-` or `@`, or that starts with a tab or carriage
 * return, is prefixed with a single quote (') so spreadsheet apps treat it
 * as text. This follows the OWASP CSV-injection guidance. The trade-off is
 * that the apostrophe becomes part of the value when the file is imported
 * elsewhere, so it is applied only to the (rare) cells that need it.
 */

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[\s\u0000-\u001F]*[=+\-@]|^[\t\r]/;

export function isFormulaLike(value: string): boolean {
  return FORMULA_START.test(value);
}

export function guardFormula(value: string): string {
  return isFormulaLike(value) ? `'${value}` : value;
}

export function escapeCsvField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvOptions {
  /** Prefix formula-like cells with an apostrophe. Default true. */
  formulaGuard?: boolean;
  /** Prepend a UTF-8 byte-order mark (helps Excel detect UTF-8). Default false. */
  bom?: boolean;
}

export function toCsv(header: string[], rows: string[][], options: CsvOptions = {}): string {
  const guard = options.formulaGuard ?? true;
  const line = (cells: string[]) =>
    cells.map((c) => escapeCsvField(guard ? guardFormula(c ?? "") : (c ?? ""))).join(",");
  const body = [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
  return (options.bom ? "\uFEFF" : "") + body;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
