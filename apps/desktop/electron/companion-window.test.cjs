const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  buildCompanionWindowUrl,
  companionWindowOptions,
  createCompanionStateStore,
  parseCompanionRequest
} = require('./companion-window.cjs')

test('parses companion launch requests', () => {
  assert.equal(parseCompanionRequest(['Hermes', '--hermes-companion=center']), 'center')
  assert.equal(parseCompanionRequest(['electron', '.', '--hermes-companion', 'island']), 'island')
  assert.equal(parseCompanionRequest(['Hermes']), null)
})

test('builds companion renderer URLs', () => {
  assert.equal(
    buildCompanionWindowUrl('center', { devServer: 'http://127.0.0.1:5174/' }),
    'http://127.0.0.1:5174/?win=companion&mode=center#/companion'
  )
  assert.match(
    buildCompanionWindowUrl('island', { rendererIndexPath: '/tmp/index.html' }),
    /^file:.*\?win=companion&mode=island#\/companion$/
  )
})

test('persists normalized companion state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-companion-'))
  const store = createCompanionStateStore(dir)
  assert.equal(store.read().enabled, false)
  store.write({ displayId: 7, enabled: true, mode: 'center', position: { x: 12.4, y: 19.8 } })
  assert.deepEqual(store.read(), {
    displayId: '7',
    enabled: true,
    mode: 'island',
    position: { x: 12, y: 20 }
  })
})

test('uses polished macOS options and cross-platform fallback', () => {
  const mac = companionWindowOptions('darwin', 'island', null)
  const expanded = companionWindowOptions('darwin', 'expanded', null)
  assert.equal(mac.frame, false)
  assert.equal(mac.transparent, true)
  assert.equal(mac.alwaysOnTop, true)
  assert.equal(mac.type, 'panel')
  assert.equal(mac.acceptFirstMouse, true)
  assert.equal(expanded.width, mac.width)
  assert.equal(expanded.height, mac.height)
  const center = companionWindowOptions('darwin', 'center', null)
  assert.equal(center.frame, true)
  assert.equal(center.transparent, false)
  assert.equal(center.alwaysOnTop, false)
  const win = companionWindowOptions('win32', 'island', null)
  assert.equal(win.frame, true)
  assert.equal(win.transparent, false)
})
