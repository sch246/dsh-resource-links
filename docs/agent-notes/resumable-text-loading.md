# Resumable text loading

The browser owns download scheduling, verified byte ranges and retry state. Provider version 0.1.5 adds three unary operations so a failed response costs one range transfer. The provider stores no download session, temporary file or download cache. Existing complete-text and stream APIs remain available to independently released consumers.

Preparation identifies the canonical path and exact stat fields without content access. Every range repeats confirmation and checks that fingerprint before and after reading. Positive short OS reads continue at the next byte; zero-byte EOF before the expected range length fails. Raw bytes preserve UTF-8 and CRLF sequences spanning requests, and each response carries its own SHA-256.

Finalization deliberately rereads the complete local file through the same stable-read owner as ordinary text access. It validates UTF-8 and NUL rules, derives EOL-aware save revision metadata and establishes the existing bounded canonical baseline. Its small response lets the browser compare the assembled canonical hash before installing text. This trades one local complete read for independent network retries without introducing a snapshot subsystem.

Stat equality cannot detect an in-place write preserving every observed identity, size and timestamp field. Canonical hash comparison checks assembled content against the final validated read; the protocol does not promise filesystem snapshot isolation. The [package reference](../../packages/dsh-user-files/README.md) owns exact fields and limits; [LOG](../../.intent/LOG.md) records validation evidence.
