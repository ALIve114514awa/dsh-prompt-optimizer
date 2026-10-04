import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

// Only installed package manifests are read. This never boots a Harness profile.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const surfaceIndex = args.indexOf('--surface')
const surface = surfaceIndex < 0 ? 'web' : args.splice(surfaceIndex, 2)[1]
if (!['web', 'desktop', 'tui'].includes(surface)) {
  throw new Error('--surface must be web, desktop, or tui')
}
const fallbackIndex = args.indexOf('--fallback')
const fallbackRoot = fallbackIndex < 0 ? undefined : args.splice(fallbackIndex, 2)[1]
const runtimeRoot = resolve(args[0] ?? root)
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const runtimeRequires = [runtimeRoot, ...(fallbackRoot ? [resolve(fallbackRoot)] : [])]
  .map(directory => createRequire(resolve(directory, 'package.json')))
const webOnly = name => name === 'react' || name.startsWith('@deepseek-ai/dsh-client-')
function resolvePeer(name) {
  for (const runtimeRequire of runtimeRequires) {
    try { return runtimeRequire.resolve(`${name}/package.json`) } catch {}
  }
  throw new Error(`Missing peer: ${name}`)
}
let failed = false
for (const [name, expected] of Object.entries(manifest.peerDependencies)) {
  if (surface === 'tui' && webOnly(name)) {
    console.log(`SKIP ${name}: Web-only peer`)
    continue
  }
  try {
    const packagePath = resolvePeer(name)
    const installed = JSON.parse(await readFile(packagePath, 'utf8'))
    const matches = semver.satisfies(installed.version, expected)
    if (!matches) failed = true
    console.log(`${matches ? 'OK' : 'MISMATCH'} ${name}: ${installed.version} (requires ${expected})`)
  } catch {
    if (manifest.peerDependenciesMeta?.[name]?.optional && !webOnly(name)) {
      console.log(`OPTIONAL ${name}: absent`)
      continue
    }
    failed = true
    console.log(`MISSING ${name} (requires ${expected})`)
  }
}
if (failed) {
  console.error('This runtime does not match the plugin\'s supported peer versions.')
  process.exitCode = 1
}
