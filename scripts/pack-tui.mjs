import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const staging = resolve(root, 'artifacts/tui-package')
const packageName = 'dsh-prompt-optimizer-tui'
const peers = Object.fromEntries(Object.entries(source.peerDependencies)
  .filter(([name]) => name !== 'react' && !name.startsWith('@deepseek-ai/dsh-client-')))
assert.equal(peers['@deepseek-harness-tui/dsh-tui'], '0.11.1')
await mkdir(resolve(staging, 'lib/types'), { recursive: true })
for (const file of ['index.js', 'tui.js']) {
  await cp(resolve(root, 'lib', file), resolve(staging, 'lib', file))
}
await cp(resolve(root, 'lib/types/host'), resolve(staging, 'lib/types/host'), { recursive: true })
await cp(resolve(root, 'locale'), resolve(staging, 'locale'), { recursive: true })
await cp(resolve(root, 'README.md'), resolve(staging, 'README.md'))
await cp(resolve(root, 'docs'), resolve(staging, 'docs'), { recursive: true })
const manifest = {
  name: packageName, version: source.version,
  description: 'Guided prompt optimization for DeepSeek Harness TUI, with an explicit unsent draft preview.',
  type: 'module', main: './lib/index.js', types: './lib/types/host/server/index.d.ts',
  exports: {
    '.': source.exports['.'], './tui': source.exports['./tui'],
    './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml', './locale/*.json': './locale/*.json',
  },
  files: ['lib/index.js', 'lib/tui.js', 'lib/types/**/*.d.ts', 'cordis.patch.yml', 'locale/*.json', 'docs/*.md', 'README.md'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  engines: source.engines,
  peerDependencies: peers,
}
await writeFile(resolve(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(resolve(staging, 'cordis.patch.yml'), `- insert:\n    - id: prompt-optimizer\n      name: ${packageName}\n    - id: prompt-optimizer-tui\n      name: ${packageName}/tui\n`)
// These are loader graphs, not platform selectors: old dsh install checks every
// DSH peer even when optional. The separate package therefore has no Web graph.
assert(!manifest.dsh.client)
assert(Object.keys(manifest.peerDependencies).every(name => !name.startsWith('@deepseek-ai/dsh-client-')))
for (const file of ['index.js', 'tui.js']) {
  const code = await readFile(resolve(staging, 'lib', file), 'utf8')
  assert(!/^import .*(?:from )?["'](?:react|@deepseek-ai\/dsh-client-)/m.test(code), `Unexpected TUI runtime import in ${file}`)
}
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['pack', '--ignore-scripts', '--pack-destination', '..'], {
  cwd: staging, stdio: 'inherit', shell: process.platform === 'win32',
})
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`TUI package verified and packed: artifacts/${packageName}-${source.version}.tgz`)
