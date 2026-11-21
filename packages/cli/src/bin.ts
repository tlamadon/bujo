import { createInterface } from 'node:readline/promises'
import { run } from './cli'

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return rl
    .question(`${question} [y/N] `)
    .then((answer) => /^y(es)?$/i.test(answer.trim()))
    .finally(() => rl.close())
}

run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  stdinIsTTY: !!process.stdin.isTTY,
  stdoutIsTTY: !!process.stdout.isTTY,
  confirm,
}).then(
  (code) => {
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
