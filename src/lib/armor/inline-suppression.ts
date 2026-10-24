import { parseUnifiedPatch } from "./diff";
import { maskSecrets } from "./secret-masking";
import { normalizeSeverity, type Severity } from "@/lib/severity";
import type { ScanFinding, FileChange } from "./scanner";

/**
 * An inline suppression directive parsed from unified diff patch lines.
 * Supported syntax:
 *   // secureflow-ignore: <reason>
 *   # secureflow-ignore: <reason>
 */
export interface InlineDirective {
  file: string;
  line: number;
  rawReason: string;
  hasReason: boolean;
}

export interface SuppressedFinding {
  severity: Severity;
  type: string;
  fileLocation: string;
  line?: number;
  reason: string;
  originalFinding: ScanFinding;
}

export interface RejectedSuppression {
  fileLocation: string;
  line?: number;
  reason: string;
  findingType?: string;
  severity?: string;
}

export interface InlineSuppressionResult {
  activeFindings: ScanFinding[];
  suppressedFindings: SuppressedFinding[];
  rejectedSuppressions: RejectedSuppression[];
  suppressedCount: number;
  rejectedCount: number;
}

/**
 * Regular expression matching inline suppression directives in comments:
 * - Line comments starting with `//` or `#`
 * - Case-insensitive `secureflow-ignore`
 * - Optional colon separator and trailing reason
 */
export const INLINE_DIRECTIVE_REGEX = /(?:^|\s)(?:\/\/|#)\s*secureflow-ignore(?::\s*(.*))?$/i;

/**
 * Sanitize an untrusted suppression reason:
 * - Capped at 200 characters
 * - Disarm @mention notifications using zero-width spaces
 * - Escape backticks to avoid markdown code span / block breaking
 * - Escape HTML special characters
 * - Redact secrets using the existing secret masking engine
 */
export function sanitizeSuppressionReason(rawReason: string): string {
  if (!rawReason) return "";

  // 1. Cap raw input at 200 characters per specification
  let reason = rawReason.trim().slice(0, 200);

  // Normalize any CRLF linebreaks to single spaces
  reason = reason.replace(/[\r\n]+/g, " ");

  // 2. Disarm @mention pings by inserting a zero-width space after '@'
  reason = reason.replace(/@([a-zA-Z0-9_\-]+)/g, "@\u200B$1");

  // 3. Escape markdown backticks to prevent breaking markdown formatting
  reason = reason.replace(/`/g, "\\`");

  // 4. Escape HTML tags to prevent HTML injection in markdown
  reason = reason.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 5. Mask any embedded secrets using the existing secret masking rules
  reason = maskSecrets(reason);

  return reason;
}

/**
 * Extract all inline suppression directives from a unified diff patch.
 * Reuses parseUnifiedPatch from diff.ts for authoritative line numbers.
 */
export function extractDirectivesFromPatch(
  patch: string,
  filename: string = "",
): InlineDirective[] {
  if (!patch) return [];

  const parsed = parseUnifiedPatch(patch);
  const directives: InlineDirective[] = [];

  for (const line of parsed.lines) {
    const match = line.content.match(INLINE_DIRECTIVE_REGEX);
    if (match) {
      const rawReason = match[1]?.trim() ?? "";
      directives.push({
        file: filename,
        line: line.number,
        rawReason,
        hasReason: rawReason.length > 0,
      });
    }
  }

  return directives;
}

function normalizePath(p: string): string {
  return p
    .replace(/^[ab]\//, "")
    .replace(/^\.\//, "")
    .trim();
}

/**
 * Apply inline suppression comments with guardrails:
 * 1. Directive sits on finding's line (`lineStart`) or directly above it (`lineStart - 1`).
 * 2. Reason required: directives with no reason do nothing, finding stays, reported as ignored.
 * 3. No inline suppression of CRITICAL findings: finding stays, reported as rejected.
 * 4. Untrusted reasons are capped at 200 characters, secrets masked, @mentions disarmed.
 * 5. Returns filtered active findings alongside audit trail of suppressed and rejected items.
 */
export function applyInlineSuppression(
  findings: ScanFinding[],
  files: readonly FileChange[],
): InlineSuppressionResult {
  const activeFindings: ScanFinding[] = [];
  const suppressedFindings: SuppressedFinding[] = [];
  const rejectedSuppressions: RejectedSuppression[] = [];

  // Map of normalized filename -> Map<line, InlineDirective>
  const fileDirectivesMap = new Map<string, Map<number, InlineDirective>>();

  for (const file of files) {
    if (!file.patch) continue;
    const directives = extractDirectivesFromPatch(file.patch, file.filename);
    const lineMap = new Map<number, InlineDirective>();
    for (const d of directives) {
      lineMap.set(d.line, d);
    }
    const norm = normalizePath(file.filename);
    fileDirectivesMap.set(norm, lineMap);
    if (norm !== file.filename) {
      fileDirectivesMap.set(file.filename, lineMap);
    }
  }

  const matchedDirectives = new Set<InlineDirective>();

  for (const f of findings) {
    const normLoc = normalizePath(f.fileLocation);
    const lineMap = fileDirectivesMap.get(normLoc) ?? fileDirectivesMap.get(f.fileLocation);

    if (!lineMap || typeof f.lineStart !== "number") {
      activeFindings.push(f);
      continue;
    }

    // Check finding's line or the line immediately above it
    const directive = lineMap.get(f.lineStart) ?? lineMap.get(f.lineStart - 1);

    if (!directive) {
      activeFindings.push(f);
      continue;
    }

    matchedDirectives.add(directive);

    // Rule 2: Reason required
    if (!directive.hasReason) {
      activeFindings.push(f);
      rejectedSuppressions.push({
        fileLocation: f.fileLocation,
        line: directive.line,
        reason: "Suppression ignored: directive requires a stated reason",
        findingType: f.type,
        severity: String(f.severity),
      });
      continue;
    }

    // Rule 3: No inline suppression of CRITICAL findings
    const normalizedSev = normalizeSeverity(f.severity);
    if (normalizedSev === "CRITICAL") {
      activeFindings.push(f);
      rejectedSuppressions.push({
        fileLocation: f.fileLocation,
        line: directive.line,
        reason: "Suppression rejected: inline suppression of CRITICAL findings is not permitted",
        findingType: f.type,
        severity: "CRITICAL",
      });
      continue;
    }

    // Valid suppression: remove from active findings, record in suppressed
    const safeReason = sanitizeSuppressionReason(directive.rawReason);
    suppressedFindings.push({
      severity: f.severity,
      type: f.type,
      fileLocation: f.fileLocation,
      line: f.lineStart,
      reason: safeReason,
      originalFinding: f,
    });
  }

  // Audit trail: capture any unused empty directives as ignored
  for (const [, lineMap] of fileDirectivesMap) {
    for (const directive of lineMap.values()) {
      if (!directive.hasReason && !matchedDirectives.has(directive)) {
        rejectedSuppressions.push({
          fileLocation: directive.file,
          line: directive.line,
          reason: "Suppression ignored: directive requires a stated reason",
        });
      }
    }
  }

  return {
    activeFindings,
    suppressedFindings,
    rejectedSuppressions,
    suppressedCount: suppressedFindings.length,
    rejectedCount: rejectedSuppressions.length,
  };
}
