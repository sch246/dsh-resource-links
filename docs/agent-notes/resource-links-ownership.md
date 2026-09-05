# Metadata discovery and explicit opening

Resource links owns displayed-message candidate recognition and Chat opening policy. The file manager is the only filesystem metadata/content authority; the resource workbench selects file handlers, and the right sidebar owns directory launcher placement. Host display code receives serializable ranges and callbacks and has no filesystem policy.

An automatic native fallback cannot distinguish a missing/inaccessible path from an unsupported preview or a failed handler. Every explicit open therefore resolves canonical metadata first and follows one configured route. `preview|system` expresses that decision without duplicating workbench handler support rules. The old manager Chat listener, helper, metadata `openMode`, Bundle value and their tests must be removed at combined cutover.

Metadata results are presentation hints. Fresh resolution on click preserves deletion/access errors after a cached link was drawn. Discovery caches only successful metadata and keys it by session plus CWD plus candidate path; errors retry on a later request. A bounded coalescing queue owns all pending work and runs one batch at a time, limiting request count without transferring path authority from the manager.

Tests exercise path punctuation, URL exclusions, successful and failed opening, explicit session navigation, batch bounds, expiry, eviction, CWD changes, cancellation and real Cordis registration/disposal. Browser output and private-Home acceptance belong to combined integration because this plugin has no independent renderer.
