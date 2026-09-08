# Preview and download ownership

The user clarified that viewing must not require choosing a local save destination. PDF preview uses parallel in-memory loading; audio/video remain native streams. Viewer custom download actions are removed. File-manager owns one persistent More-menu checkbox, default off, controlling its existing download button. No additional per-file download button is introduced. The provider shares one guarded Range implementation between Blob reads and positioned local writes.

Validation is limited to owned builds and source review; no product-behavior tests or browser interaction automation are requested. Actual browser interaction and network speed remain unverified.
