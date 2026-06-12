const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const geometrySource = path.join(root, 'electron', 'native', 'macos-companion.swift')
const appSource = path.join(root, 'electron', 'native', 'macos-companion-app.swift')
const outputDir = path.join(root, 'build', 'native-tools')
const geometryOutput = path.join(outputDir, 'hermes-companion-geometry')
const appOutput = path.join(outputDir, 'hermes-companion-native')

fs.mkdirSync(outputDir, { recursive: true })
if (process.platform !== 'darwin') process.exit(0)

execFileSync('xcrun', ['swiftc', '-O', geometrySource, '-o', geometryOutput], { stdio: 'inherit' })
execFileSync('xcrun', ['swiftc', '-parse-as-library', '-O', appSource, '-o', appOutput], { stdio: 'inherit' })
