# Native PDF and media readers

The user requested a PDF reader and audio/video viewing after approving shared binary transport extraction. The implementation keeps handlers in the existing viewer repository and uses the browser renderer to avoid introducing another document or media engine.

Extended the shared authenticated binary endpoint with single byte-range reads, 206/416 responses, full HEAD metadata and approved inline audio/video MIME types. Multipart/invalid range requests and If-Range fall back to full responses. Existing upload publication and authentication remain provider-owned. Range requests independently read the current file; they do not promise a stable snapshot under external mutation.

Built user-files with scripts/build.sh and viewer with scripts/build-host.sh, both against DSH_CHECKOUT=/root/deepseek-harness; both completed successfully. One lightweight read-only agent inspected the bounded streaming and teardown paths. No tests were added or run, no browser automation or worktrees were created. Native rendering, seeking and codec compatibility were not visually exercised.

The existing Web profile already links both packages; no Bundle membership, profile configuration, reverse-proxy setting or official Harness source changed. Restarted dsh-web under the existing activation authorization. The service reported active and its homepage returned HTTP 200. This establishes startup, not browser acceptance. STATE and the package references describe the supported effects and deployment requirements.
