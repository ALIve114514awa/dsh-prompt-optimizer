import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

// Every shared library resolves from the Harness module table at runtime.
// Keeping the shell's React and Cordis instances is necessary for hooks and DI.
const shared = [
  'react', 'react/jsx-runtime',
  'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

for (const config of ['tsconfig.host.json', 'tsconfig.client.json']) {
  const result = spawnSync(process.execPath, [
    resolve(root, 'node_modules/typescript/bin/tsc'), '-p', config,
  ], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

await mkdir(resolve(root, 'lib'), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/server/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
})

await build({
  absWorkingDir: root,
  entryPoints: ['src/tui/index.ts'],
  outfile: 'lib/tui.js',
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
})

const client = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: shared,
  jsx: 'automatic',
  metafile: true,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
await writeFile(resolve(root, 'lib/client.meta.json'), JSON.stringify(client.metafile, null, 2))
console.log(`Built ${manifest.name}: lib/index.js, lib/tui.js, and lib/client.js`)
