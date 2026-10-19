---
"secureflow": patch
---

Outbound webhooks (the outbound worker and Slack alerts) now connect only to the addresses that passed the destination checks. Dispatch previously validated the DNS answer and then let `fetch` resolve the hostname again, so a DNS server answering with a zero TTL could steer the connection to an internal address such as `169.254.169.254`. Requests are now sent by `pinnedTransport` (`src/lib/queue/outbound-dispatch.ts`), which keeps TLS certificate verification, SNI and the `Host` header bound to the hostname. The IPv6 classifier now also refuses NAT64, 6to4, SIIT and Teredo addresses that wrap a private IPv4 address, plus documentation and site-local ranges.
