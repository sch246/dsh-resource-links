# Text access confirmation

Large text access is a user choice. The provider uses its existing configured text threshold to require explicit request permission, while the consumer owns the confirmation interaction. Metadata supplies the size before file content is read. The typed Remote failure carries the actual size and threshold so consumers need not infer a policy from diagnostic prose.

Confirmation applies to loading existing disk content, including guarded-save revision checks and refreshes. Local replacement text is already available to the caller, so its growth does not require confirmation or prevent the save from returning a published revision. It does not authorize byte operations or weaken UTF-8 validation, revision comparison, EOL restoration or atomic publication. The same provider queue and read implementation serve confirmed and unconfirmed requests; there is no second large-file storage path.

The [package reference](../../packages/dsh-user-files/README.md) owns API semantics. [Execution evidence](../../.intent/LOG.md#2026-09-07-large-text-confirmation-provider-candidate) identifies the candidate checks and deployment limitations.
