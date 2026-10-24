---
"secureflow": minor
---

**Breaking for some senders.** `POST /api/webhooks` and `POST /api/webhooks/generic` no longer admit a legacy `sha256=` signature computed over the bare body. That digest covers no timestamp, so a captured request could be replayed at any later time by setting `X-SecureFlow-Timestamp` to the current time, and any timestamp-bound digest doubled as a bare digest of the body `<t>.<body>`. v1 signatures (`t=<unix>,v1=<hex>`) and legacy digests over `<unix>.<body>` (what `signOutboundWebhook` sends) are unaffected. Senders that cannot switch yet can be re-admitted with `WEBHOOK_ALLOW_UNBOUND_LEGACY_SIGNATURES=true`; `withWebhookGuard`, `verifyWebhookRequest` and `admitWebhookRequest` take an `allowUnboundLegacySignatures` option for the same purpose.
