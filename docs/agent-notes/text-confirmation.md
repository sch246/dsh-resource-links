# Text access confirmation

Large text access is a user choice. The provider uses its existing configured text threshold to require explicit request permission, while the consumer owns the confirmation interaction. Metadata supplies the size before file content is read. The typed Remote failure carries the actual size and threshold so consumers need not infer a policy from diagnostic prose. A request can carry an inclusive confirmed-size ceiling to ensure that later disk growth requires a fresh choice. The provider validates that ceiling once while resolving the text policy; the Remote maps invalid values to `gateway/bad-request`.

Confirmation applies to loading existing disk content, including guarded-save revision checks and refreshes. Local replacement text is already available to the caller, so its growth does not require confirmation or prevent the save from returning a published revision. It does not authorize byte operations or weaken UTF-8 validation, revision comparison, EOL restoration or atomic publication. Complete and streamed reads share the confirmation policy, raw-hash revision format and EOL interpretation; every save uses the existing provider queue.

Read and save results report exact disk bytes from the same observed stat used by the revision. Consumers need no repeated whole-document encoding to recover that metadata.

Streaming carries incremental decoder, hash and EOL state. A pending CR keeps a CRLF pair intact across raw reads. The final revision compares the open file and current path metadata with the initial stat, without rereading content. No completion event is emitted for partial, invalid or changed content. The file closes on cancellation, consumer return or completion.

The [package reference](../../packages/dsh-user-files/README.md) owns API semantics. [Execution evidence](../../.intent/LOG.md#2026-09-07-large-text-confirmation-provider-candidate) identifies the candidate checks and deployment limitations.
