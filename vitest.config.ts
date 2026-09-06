import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    '@deepseek-ai/dsh-session-persistence': new URL('./harness/packages/session/session-persistence/src/errors.ts', import.meta.url).pathname,
    '@deepseek-ai/dsh-client-ui-chat/client': new URL('./harness/packages/client/ui-chat/src/client/open-workspace-file.ts', import.meta.url).pathname,
  } },
  test: { include: ['packages/dsh-user-files/tests/**/*.spec.{ts,tsx}'] },
})
