#!/usr/bin/env node
/**
 * Bump RC version before internal builds.
 *
 * Rules:
 *   2.0.8        → 2.0.8-rc.1  (stable → same version rc.1)
 *   2.0.8-rc.1   → 2.0.8-rc.2  (rc → increment rc number)
 *
 * To release a new stable version, manually run: npm version patch/minor/major
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '../package.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const current = pkg.version

let next

const rcMatch = current.match(/^(\d+\.\d+\.\d+)-rc\.(\d+)$/);
if (rcMatch) {
  // Already an RC: bump rc number
  const base = rcMatch[1]
  const rcNum = parseInt(rcMatch[2], 10)
  next = `${base}-rc.${rcNum + 1}`
} else {
  // Stable version: start rc.1 on same version
  next = `${current}-rc.1`
}

pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`version bumped: ${current} → ${next}`)
