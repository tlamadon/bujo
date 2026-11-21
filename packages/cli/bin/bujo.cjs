#!/usr/bin/env node
// Launcher for the bundled CLI. It exists (and is committed) so that npm can
// link the `bujo` command at install time, before the bundle has been built.
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const bundle = join(__dirname, '..', 'dist', 'bujo.cjs')
if (!existsSync(bundle)) {
  process.stderr.write('error: the bujo CLI has not been built yet — run `npm run build:cli` in the repository\n')
  process.exit(1)
}
require(bundle)
