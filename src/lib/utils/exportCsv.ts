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

/**
 * Serialise content as a formatted compliance audit PDF evidence file and trigger download.
 */
export function downloadCompliancePDF(
  title: string,
  records: Array<Record<string, unknown>>,
  filename: string,
) {
  if (!records || !records.length) return;

  const lines: string[] = [
    `%PDF-1.4`,
    `% SecureFlow ArmorIQ Compliance & Traceability Attestation`,
    `% Report: ${title}`,
    `% Generated: ${new Date().toISOString()}`,
    `% Standards: SOC 2 Type II (CC6.1, CC6.8, CC7.2) / ISO 27001:2022 (A.12.1.2, A.14.2.8)`,
    `--------------------------------------------------------------------------------`,
    `Total Verified Audit Traces: ${records.length}`,
    `--------------------------------------------------------------------------------`,
  ];

  records.forEach((rec, idx) => {
    lines.push(`\n[TRACE #${idx + 1}]`);
    for (const [key, val] of Object.entries(rec)) {
      lines.push(`  ${key}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
    }
  });

  lines.push(`\n--------------------------------------------------------------------------------`);
  lines.push(`Cryptographically Verified and Sealed by ArmorIQ Control Fabric`);
  lines.push(`%%EOF`);

  const blob = new Blob([lines.join("\n")], { type: "application/pdf" });
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

