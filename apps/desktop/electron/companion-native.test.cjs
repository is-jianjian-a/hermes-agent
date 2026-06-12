const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { mergeDisplayGeometry, nativeCompanionBinary, selectCompanionDisplay } = require('./companion-native.cjs')

test('merges native notch geometry into Electron display coordinates', () => {
  const rows = mergeDisplayGeometry(
    [{ id: 1, label: 'External', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: {} }],
    [{ id: 1, name: 'Studio Display', hasNotch: true, notchHeight: 32, notchWidth: 210 }]
  )

  assert.equal(rows[0].name, 'Studio Display')
  assert.equal(rows[0].hasNotch, true)
  assert.equal(rows[0].notchWidth, 210)
})

test('selects the persisted display, then primary, then first available', () => {
  const displays = [{ id: '1' }, { id: '2' }]
  assert.equal(selectCompanionDisplay(displays, '2', '1').id, '2')
  assert.equal(selectCompanionDisplay(displays, 'missing', '1').id, '1')
  assert.equal(selectCompanionDisplay(displays, null, 'missing').id, '1')
})

test('resolves the native companion from source and packaged resource roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-native-companion-'))
  const appPath = path.join(root, 'app')
  const resourcesPath = path.join(root, 'resources')
  const sourceBinary = path.join(appPath, 'build', 'native-tools', 'hermes-companion-native')
  const packagedBinary = path.join(resourcesPath, 'native-tools', 'hermes-companion-native')
  fs.mkdirSync(path.dirname(sourceBinary), { recursive: true })
  fs.mkdirSync(path.dirname(packagedBinary), { recursive: true })
  fs.writeFileSync(sourceBinary, '')
  fs.writeFileSync(packagedBinary, '')

  assert.equal(nativeCompanionBinary({ appPath, resourcesPath, packaged: false }), sourceBinary)
  assert.equal(nativeCompanionBinary({ appPath, resourcesPath, packaged: true }), packagedBinary)
})
