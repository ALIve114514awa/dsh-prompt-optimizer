import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const code = await readFile(resolve(root, 'lib/client.js'), 'utf8')
const registrations = []
vm.runInNewContext(code, {
  window: { __ModuleLoader__: { load: value => registrations.push(value) } },
}, { timeout: 1000, filename: 'client.js' })
assert.equal(registrations.length, 1, 'Client bundle must only register one factory at script load')
assert.equal(registrations[0].id, manifest.name, 'Client registration id must equal the package name')
assert.equal(typeof registrations[0].factory, 'function')

const meta = JSON.parse(await readFile(resolve(root, 'lib/client.meta.json'), 'utf8'))
const shared = new Set([
  'react', 'react/jsx-runtime',
  'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])
for (const output of Object.values(meta.outputs)) {
  for (const dependency of output.imports) {
    assert(dependency.external && shared.has(dependency.path),
      `Unexpected client import: ${dependency.path}`)
  }
}
for (const input of Object.keys(meta.inputs)) {
  assert(!/node_modules\/(?:react(?:-dom)?|@deepseek-ai\/cordis)\//.test(input),
    `Shared runtime must not be inlined: ${input}`)
  assert(!/src\/server\//.test(input), `Server code leaked into client: ${input}`)
}
for (const entry of ['.', './client', './tui']) {
  await access(resolve(root, manifest.exports[entry].default))
  await access(resolve(root, manifest.exports[entry].types))
}
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
await access(resolve(root, manifest.dsh.bundle.patch))
console.log('Package verified: registration, shared runtimes, browser isolation, exports, and patch')
