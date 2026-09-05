import type { UserConfig } from 'tsdown'

export default {
  entry: { client: 'lib/types/client/index.js' }, outDir: 'lib', format: 'cjs',
  platform: 'browser', dts: false, sourcemap: true, clean: false,
  external: ['@deepseek-ai/cordis'],
  noExternal: (id: string) => id !== '@deepseek-ai/cordis',
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-external/dsh-resource-links", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
