# Bounded text deltas

The provider owns path-scoped canonical baselines, exact disk observations, background admission and delta size/computation budgets. The consumer owns polling intervals, backoff and an explicit manual fallback. A cache miss, exhausted budget or busy provider never authorizes an implicit complete-text response. Manual operations bypass the background permit.

A baseline is published only from a validated complete read, completed stream or actual patch-save output. Retained canonical strings have independent byte and entry bounds; eviction is ordinary and returns an explicit cache-miss outcome. Stream candidates are individually bounded, and disposal prevents late cache publication. Cache limits do not cap explicit file access.

Unchanged stat identity avoids opening content. This optimization relies on filesystem metadata: an in-place same-size write that preserves every observed timestamp and identity field can remain undetected. A changed stat triggers content validation and canonical comparison. Atomic save preconditions continue to use complete content hashes and their own final snapshot check.

The shared neutral helper uses pinned `diff` 8.0.4 `diffArrays`, with canonical LF tokens and maintained timeout/edit-distance support ([upstream documentation](https://github.com/kpdecker/jsdiff/blob/v8.0.4/README.md)). Pure insertions expand into hashed context, and overlapping expansions merge. Host range validation and browser patch application share one implementation. Diff time limits are cooperative, with checks around tokenization and the library call; they are not event-loop preemption.

Response limits include the encoded success envelope, revision and hash fields, multibyte UTF-8 and JSON escapes. Cheap string-length checks prevent large replacements from reaching whole-envelope serialization. Fixed control responses remain available under tiny requested caps. The [package reference](../../packages/dsh-user-files/README.md) owns API details; [LOG](../../.intent/LOG.md) records candidate evidence.
