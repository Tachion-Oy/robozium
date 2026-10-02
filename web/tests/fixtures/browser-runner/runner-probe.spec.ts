import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const probe = process.env.ROBOZIUM_E2E_RUNNER_PROBE === '1' ? test : test.skip

probe('probe ordinary failure', () => expect(1).toBe(2))
probe('probe flaky', ({}, info) => expect(info.retry).toBeGreaterThan(0))
for (let index = 0; index < 3; index++) {
  probe(`probe failure ${index}`, () => expect(1).toBe(2))
}
probe('probe passing', () => expect(1).toBe(1))
probe('probe skipped', () => test.skip(true, 'unexpected infrastructure skip'))
probe('probe sleeping', async () => {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
})
probe('probe service exit', async () => {
  const pid = Number(fs.readFileSync(path.join(process.env.ROBOZIUM_E2E_CONTROL_DIR!, 'backend.pid'), 'utf8'))
  process.kill(pid, 'SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 10_000))
})
