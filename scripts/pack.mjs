import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(resolve(root, 'artifacts'), { recursive: true })
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['pack', '--pack-destination', 'artifacts'], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
