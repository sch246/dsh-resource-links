import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['packages/dsh-resource-links/tests/**/*.spec.ts'] } })
