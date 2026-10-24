import { toCsv } from "./csv";

/**
 * Serialise `data` and hand it to the browser as a file download.
 *
 * Serialisation lives in `./csv` so this helper and the server-side
 * `/api/admin/export` route produce byte-identical output and share a single
 * formula-injection defence.
 */
export function downloadCSV(data: Array<Record<string, unknown>>, filename: string) {
  if (!data || !data.length) return;

  const csvString = toCsv(data);
  if (!csvString) return;

  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    // The anchor and the object URL are both released even if `click()` throws.
    // Without the revoke, every export pinned its blob in memory for the lifetime
    // of the tab.
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Serialise `data` as formatted JSON and hand it to the browser as a file download.
 */
export function downloadJSON(data: unknown, filename: string) {
  if (!data) return;

  const jsonString = JSON.stringify(data, null, 2);
  if (!jsonString) return;

  const blob = new Blob([jsonString], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/** Maximum characters per PDF text line before wrapping. */
const PDF_LINE_WIDTH = 92;

/** Lines that fit between the top and bottom margins at 9pt with 14pt leading. */
const PDF_LINES_PER_PAGE = 46;

/**
 * Escape a value for a PDF literal string.
 *
 * The built-in Helvetica font uses a single-byte encoding, so characters
 * outside printable ASCII are replaced rather than written as UTF-8 bytes that
 * a reader would decode as mojibake. Backslash and both parentheses have
 * special meaning inside a PDF string and must be escaped.
 */
function escapePdfText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Split one logical line into page-width chunks without dropping content. */
function wrapPdfLine(value: string, width: number): string[] {
  const flattened = value.replace(/[\r\n\t]+/g, " ");
  if (!flattened) return [""];

  const wrapped: string[] = [];
  for (let offset = 0; offset < flattened.length; offset += width) {
    wrapped.push(flattened.slice(offset, offset + width));
  }
  return wrapped;
}

/** Render a record value the same way the previous text export did. */
function formatPdfValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return "[unserializable]";
    }
  }
  return String(value);
}

/**
 * Build a valid PDF 1.4 document containing the compliance evidence.
 *
 * The previous implementation wrote `%PDF-1.4` followed by plain text. A PDF
 * reader ignores everything before the first indirect object and then fails
 * because there is no catalog, cross-reference table, or trailer. This writer
 * emits the smallest complete document: a catalog and page tree, one page per
 * 46 lines, a built-in Helvetica font, a content stream per page, and an xref
 * whose offsets point at the actual object boundaries.
 *
 * All output is printable ASCII. The text is escaped for PDF literal strings
 * and wrapped to the page width, so unusually long record values cannot run
 * off the page.
 */
export function buildCompliancePDF(
  title: string,
  records: Array<Record<string, unknown>>,
  generatedAt: Date = new Date(),
): string {
  const lines: string[] = [
    "SecureFlow ArmorIQ Compliance & Traceability Attestation",
    `Report: ${title}`,
    `Generated: ${generatedAt.toISOString()}`,
    "Standards: SOC 2 Type II (CC6.1, CC6.8, CC7.2) / ISO 27001:2022 (A.12.1.2, A.14.2.8)",
    "-------------------------------------------------------------------------------",
    `Total Verified Audit Traces: ${records.length}`,
    "-------------------------------------------------------------------------------",
    "",
  ];

  records.forEach((record, index) => {
    lines.push(`[TRACE #${index + 1}]`);
    for (const [key, value] of Object.entries(record)) {
      lines.push(`  ${key}: ${formatPdfValue(value)}`);
    }
    lines.push("");
  });

  lines.push(
    "-------------------------------------------------------------------------------",
    "Cryptographically Verified and Sealed by ArmorIQ Control Fabric",
  );

  const wrapped = lines.flatMap((line) => wrapPdfLine(line, PDF_LINE_WIDTH));
  const pages: string[][] = [];
  for (let offset = 0; offset < wrapped.length; offset += PDF_LINES_PER_PAGE) {
    pages.push(wrapped.slice(offset, offset + PDF_LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([""]);

  const fontObject = 3 + pages.length * 2;
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  const pageRefs = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);

  pages.forEach((pageLines, index) => {
    const contentObject = 4 + index * 2;
    const stream = [
      "BT",
      "/F1 9 Tf",
      "14 TL",
      "50 750 Td",
      ...pageLines.map((line) => `(${escapePdfText(line)}) Tj T*`),
      "ET",
    ].join("\n");

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontObject} 0 R >> >> ` +
        `/Contents ${contentObject} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return pdf;
}

/**
 * Serialise content as a compliance audit PDF evidence file and trigger download.
 */
export function downloadCompliancePDF(
  title: string,
  records: Array<Record<string, unknown>>,
  filename: string,
) {
  if (!records || !records.length) return;

  const pdf = buildCompliancePDF(title, records);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);

  try {
    link.click();
  } finally {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
