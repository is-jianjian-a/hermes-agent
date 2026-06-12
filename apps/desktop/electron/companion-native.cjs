const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function nativeGeometryBinary({ appPath, resourcesPath, packaged }) {
  const candidates = packaged
    ? [path.join(resourcesPath, 'native-tools', 'hermes-companion-geometry')]
    : [path.join(appPath, 'build', 'native-tools', 'hermes-companion-geometry')]
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

function nativeCompanionBinary({ appPath, resourcesPath, packaged }) {
  const candidates = packaged
    ? [path.join(resourcesPath, 'native-tools', 'hermes-companion-native')]
    : [path.join(appPath, 'build', 'native-tools', 'hermes-companion-native')]
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

function readMacDisplayGeometry(options) {
  if (process.platform !== 'darwin') return []
  const binary = nativeGeometryBinary(options)
  if (!binary) return []
  try {
    const value = JSON.parse(execFileSync(binary, { encoding: 'utf8', timeout: 3000 }))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function mergeDisplayGeometry(electronDisplays, nativeDisplays) {
  return electronDisplays.map(display => {
    const native = nativeDisplays.find(item => Number(item.id) === Number(display.id))
    return {
      id: String(display.id),
      name: native?.name || display.label || `Display ${display.id}`,
      bounds: display.bounds,
      workArea: display.workArea,
      hasNotch: Boolean(native?.hasNotch),
      notchWidth: Number(native?.notchWidth) || 190,
      notchHeight: Number(native?.notchHeight) || Math.max(24, display.bounds.y - display.workArea.y)
    }
  })
}

function selectCompanionDisplay(displays, preferredId, primaryId) {
  return (
    displays.find(display => String(display.id) === String(preferredId)) ||
    displays.find(display => String(display.id) === String(primaryId)) ||
    displays[0] ||
    null
  )
}

module.exports = {
  mergeDisplayGeometry,
  nativeCompanionBinary,
  nativeGeometryBinary,
  readMacDisplayGeometry,
  selectCompanionDisplay
}
