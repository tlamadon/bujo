// Bundle the CLI (and @bujo/core) into one self-contained CommonJS file.
import { build } from 'esbuild'
import { chmodSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const outfile = process.argv[2] ?? join(here, 'dist', 'bujo.cjs')

await build({
  entryPoints: [join(here, 'src', 'bin.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { __BUJO_CLI_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
})
chmodSync(outfile, 0o755)
