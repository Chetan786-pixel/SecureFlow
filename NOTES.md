# Deterministic Secret Pre-Scanner (#1448)

## What Changed

1. **Rule-Based Pre-Scanner (`src/lib/armor/secret-detector.ts`)**:
   - Implemented a pure, dependency-free detector module that inspects added diff lines (`+` lines) and flags credentials before LLM dispatch.
   - Detects five core secret families:
     - **AWS Access Key IDs**: `/(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}/` (`HIGH` severity)
     - **GitHub Tokens**: classic `gh[oprsu]_` and fine-grained `github_pat_` (`HIGH` severity)
     - **Slack Tokens**: `xox[baprse]-...` (`HIGH` severity)
     - **PEM Private Key Headers**: `-----BEGIN ... PRIVATE KEY-----` (`CRITICAL` severity)
     - **Quoted Secret Assignments**: Key names matching `secret`, `token`, `password`, `api_key` assigned long quoted values (`HIGH` severity)
   - Excludes placeholders (`YOUR_API_KEY_HERE`, `changeme`, `process.env.*`, `mock_*`, etc.) and non-added context/removed lines.
   - Masks the middle of detected secrets (`maskSecretValue` and `maskSnippet`), ensuring raw credentials are never stored in the database or posted to pull request comments.
2. **Scanner Integration (`src/lib/armor/scanner.ts`)**:
   - `ArmorIQScanner.scanPullRequest` runs `detectSecretsInFiles` before LLM batch processing.
   - LLM batch processing is wrapped in resilient error handling. If Groq encounters timeouts, 503 service unavailable, or rate limits, the scan does not crash; it logs a warning and proceeds with deterministic findings.
   - Merges deterministic findings with LLM findings via `mergeFindings`, dropping duplicates on matching file and line.
3. **Tests (`src/lib/armor/secret-detector.test.ts`)**:
   - 13 comprehensive Vitest tests covering all secret families, placeholders, removed lines, masking, merge deduplication, and scanner resilience when Groq fails.

## How to Run Tests

```bash
# Run unit and integration tests
npx vitest run src/lib/armor/secret-detector.test.ts src/lib/armor/scanner.test.ts src/lib/armor/secret-masking.test.ts

# TypeScript typecheck
npm run typecheck

# Code formatting and lint
npm run lint
```

## Known Gaps

- Scans pull request unified diffs for added lines; whole-repository historical commit walking is out of scope per issue boundaries.
- Uses rule-based regex patterns; entropy detection is tuned for high-entropy credential assignments and avoids flagging lockfile integrity hashes.
