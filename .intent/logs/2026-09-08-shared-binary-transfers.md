# Shared binary transfer extraction

The user approved moving the existing manager transport into our shared user-files plugin to make it reusable by independent previews, without an official Harness change or another repository.

User-files now owns authenticated binary HTTP streaming, MIME/disposition selection, the browser-safe transfer URL export and maxUploadBytes. Web service dependencies are optional. The existing transfer integrity checks moved with their implementation.

Built both providers and consumers with DSH_CHECKOUT=/root/deepseek-harness and their existing scripts/build.sh entries. Both completed successfully. Updated the provider lockfile with pnpm install --lockfile-only --ignore-scripts; this also pruned obsolete test-library resolutions left after the preceding test cleanup. No new tests, test runs, worktrees or browser automation.

The Web profile already links the intended top-level packages and has no explicit maxUploadBytes override; the effective 10 GiB default is preserved by user-files. Bundle membership, profile configuration and official Harness source were not changed. Migrated the nginx exact transfer route to /api/user-files/transfer, preserving limits and headers; backed up its previous configuration under /root/.local/state/dsh-maintenance/2026-09-08-user-file-transfers/. nginx -t passed, nginx reloaded and dsh-web restarted. The service is active, the homepage returned HTTP 200, and the new route returned HTTP 400 for a request missing required query fields. These observations establish startup and route registration, not authenticated transfer or visual acceptance.

PDF inline transport is available; a PDF rendering handler and HTTP Range support are not implemented by this change. Manager upload/download interaction remains for direct user observation.
