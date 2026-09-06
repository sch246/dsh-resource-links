# Optional Links dependency intent

The user requests that installation STATE distinguish optional integration from required dependencies. Links is intended as an optional feature of shared authenticated user-file access, independent of sidebar, viewer and manager UI. The current mandatory injections and direct routing remain documented as pending migration work. Compatible APIs do not require identical package versions.

This change updates STATE, agent navigation and README in the isolated candidate. It changes no runtime, profile, receipt or service. The preceding inline-code correction remains a separate candidate commit; documentation does not activate it. Validation is limited to local document references and Git whitespace checks.

## Installation-map correction

The user clarified that STATE is an executable installation and maintenance prompt: it provides source references and steps for adapting to a changing Host and environment, while feedback makes intent more precise. It is not a debt inventory or refactor progress board. This corrects the preceding document's target/current/pending comparison. STATE now carries capability selection, source navigation and concrete adaptation steps; this log owns implementation gaps and execution status.

At candidate commit `aa92e89fe044a2c2001a7616ae415e79f89a7529`, Client registration still requires manager Remote, sidebar and resourceWorkbench, and runtime opening still constructs viewer descriptors or invokes Files. Shared-provider extraction, optional Links composition and profile transfer are not implemented. The parser/Host inline-code correction is implemented separately and remains unactivated. Historical installation recipes describe those concrete sources; they are inputs to adaptation, not permanent feature requirements.

The new map preserves source locations, receipt attribution, Typert support, configuration and failure behavior while replacing the mandatory whole-feature install recipe with capability-based composition. Local links and whitespace are the checks for this documentation change; no additional runtime tests or deployments were run.

## Isolated shared-provider implementation

The existing repository now distributes `@dsh-external/dsh-user-files`; the old resource-links runtime package is removed. Host `ctx.userFiles`, generated `remote.userFiles`, optional Links and common opening policy are wired independently of UI features. One shared mutation queue serializes text/byte publication and manager directory mutations, with cancellation checked before queued execution. Reads remain outside the queue. Links forwards cancellation to the common Host opener and requires Session/native Remote injection only for its enabled runtime.

Repository-local TypeScript 5.9.3, tsdown 0.22.14 and Vitest 4.1.8 installed successfully. Vite is pinned to 7.3.6: a fresh manager install selected Vite 8.2.2, whose source transformer retained `@Remote` decorators and failed at evaluation. The shared package's 8 Vitest files passed 45 tests; ownership and residual-link Node tests passed 6 tests. Final Host/Remote/Client build and typecheck passed after the shared mutation queue and installer export were integrated.

The unified owned Host patch and frozen former Links patch are present. No live receipt, profile or service was changed. The parent integration record owns exact effective configuration migration and private before/after rows. Package build and focused tests do not establish cold-boot, browser or managed activation acceptance.
