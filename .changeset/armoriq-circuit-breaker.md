---
"secureflow": patch
---

Calls to the ArmorIQ control plane (`ArmorIQService.verifyIntentToken`, `ArmorIQService.getProtectedToken` and the intent token mint in `POST /api/findings/[id]/remediate/apply`) now go through a shared circuit breaker. After 3 consecutive upstream failures (timeouts, rate limits, 5xx or network errors) the circuit opens and callers fail fast and closed instead of each waiting out its own timeout: verification returns `{ valid: false, unavailable: true }` and the remediation apply route answers `503` without writing to GitHub. A probe is let through after 30 seconds. A token that ArmorIQ answers and rejects does not count as an outage. Tune with the new optional `ARMORIQ_CIRCUIT_FAILURE_THRESHOLD` and `ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS`.
