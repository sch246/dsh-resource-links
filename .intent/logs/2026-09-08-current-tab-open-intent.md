# Current-tab intent on the shared opening request

The user asked for one navigation behavior across session links, the path bar, the file manager, Markdown links and group Back/Forward. The shared provider's share is the request fields that let a handler move its own tab instead of adding one, declared where the existing line/column extension already lives.

`packages/dsh-user-files/src/file-location.ts` now declares `WorkspaceFileOpenIntent` and merges it into `ChatFileOpenRequest` beside `textSelection`: optional `viewId`, optional `replace: 'current'` and optional `sourceInstanceId`. The Host package is unchanged; its `openWorkspaceFile` passes the request object through, so declaration merging is enough for the viewer and manager to read and send these fields. Links keeps sending only path, session and location intent, and a profile without Links still carries them because the viewer imports the same declaration.

The provider version stays `0.1.8`; the added fields are optional and no consumer requires a new minimum.

Verification: `DSH_CHECKOUT=/root/deepseek-harness bash scripts/typecheck.sh` and `bash scripts/build.sh` pass, and the built `lib/types/file-location.d.ts` contains the merged interface. No browser automation was run.
