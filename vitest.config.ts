import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { include: ['packages/dsh-resource-links/tests/**/*.spec.{ts,tsx}'] },
})
