const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const COMPANION_ARG = '--hermes-companion'
const DEFAULT_STATE = Object.freeze({
  displayId: null,
  enabled: false,
  mode: 'island',
  position: null
})

function parseCompanionRequest(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '')
    if (arg === COMPANION_ARG) {
      const next = String(argv[index + 1] || '').toLowerCase()
      return next === 'center' ? 'center' : 'island'
    }
    if (arg.startsWith(`${COMPANION_ARG}=`)) {
      return arg.slice(COMPANION_ARG.length + 1).toLowerCase() === 'center' ? 'center' : 'island'
    }
  }
  return null
}

function buildCompanionWindowUrl(mode, { devServer, rendererIndexPath } = {}) {
  const normalized = mode === 'center' ? 'center' : mode === 'expanded' ? 'expanded' : 'island'
  const query = `win=companion&mode=${normalized}`
  if (devServer) {
    const base = devServer.endsWith('/') ? devServer.slice(0, -1) : devServer
    return `${base}/?${query}#/companion`
  }
  return `${pathToFileURL(rendererIndexPath).toString()}?${query}#/companion`
}

function normalizeState(value) {
  const position =
    value?.position && Number.isFinite(value.position.x) && Number.isFinite(value.position.y)
      ? { x: Math.round(value.position.x), y: Math.round(value.position.y) }
      : null
  return {
    displayId: value?.displayId == null ? null : String(value.displayId),
    enabled: Boolean(value?.enabled),
    mode: 'island',
    position
  }
}

function createCompanionStateStore(userDataDir) {
  const statePath = path.join(userDataDir, 'companion.json')
  return {
    path: statePath,
    read() {
      try {
        return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf8')))
      } catch {
        return { ...DEFAULT_STATE }
      }
    },
    write(next) {
      const state = normalizeState(next)
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      return state
    }
  }
}

function companionWindowOptions(platform, mode, position) {
  const center = mode === 'center'
  const mac = platform === 'darwin'
  const options = {
    width: center ? 980 : 560,
    height: center ? 720 : 430,
    minWidth: center ? 720 : 320,
    minHeight: center ? 520 : 430,
    maxWidth: center ? undefined : 560,
    maxHeight: center ? undefined : 430,
    type: mac && !center ? 'panel' : undefined,
    acceptFirstMouse: mac && !center,
    frame: center || !mac,
    transparent: mac && !center,
    resizable: center || !mac,
    alwaysOnTop: !center,
    skipTaskbar: !center,
    show: false,
    backgroundColor: mac && !center ? '#00000000' : '#15171c',
    ...(position ? { x: position.x, y: position.y } : {})
  }
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
}

module.exports = {
  COMPANION_ARG,
  DEFAULT_STATE,
  buildCompanionWindowUrl,
  companionWindowOptions,
  createCompanionStateStore,
  normalizeState,
  parseCompanionRequest
}
