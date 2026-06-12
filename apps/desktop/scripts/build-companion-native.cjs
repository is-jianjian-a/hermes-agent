const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'electron', 'native', 'macos-companion.swift')
const outputDir = path.join(root, 'build', 'native-tools')
const output = path.join(outputDir, 'hermes-companion-geometry')

fs.mkdirSync(outputDir, { recursive: true })
if (process.platform !== 'darwin') process.exit(0)

execFileSync('xcrun', ['swiftc', '-O', source, '-o', output], { stdio: 'inherit' })
