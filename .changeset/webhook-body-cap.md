---
"secureflow": patch
---

`POST /api/webhooks` and `POST /api/webhooks/generic` now cap the request body at 1 MiB (configurable with the new optional `WEBHOOK_MAX_BYTES`) and answer `413` above it. The guard read the whole body with `req.text()` before checking the signature, so an unauthenticated caller could make the process buffer an unbounded body. A declared `Content-Length` over the cap is refused without reading, and the bytes actually received are counted so chunked or mislabelled bodies are cut off too. The HMAC is now verified over the body bytes exactly as received rather than over a decoded string, which also stops bodies that are not valid UTF-8 from being rejected despite a correct signature.
