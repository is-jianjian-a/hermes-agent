import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import {
  deleteLegacySession,
  getLegacySession,
  getProfiles,
  getSessionMessages,
  getSessionSummary,
  HermesGateway,
  listAllProfileSessions,
  listLegacySessions,
  renameSession,
  setSessionArchived
} from '@/hermes'
import { resolveGatewayWsUrl } from '@/lib/gateway-ws-url'
import {
  Archive,
  ArchiveOff,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pin,
  Search,
  Trash2,
  X
} from '@/lib/icons'
import type { LegacySessionDetail, LegacySessionInfo, ProfileInfo, SessionInfo, SessionMessage } from '@/types/hermes'

import {
  type CompanionMode,
  favoriteKey,
  filterSessions,
  hoverTransition,
  type LiveSession,
  type SessionFilter,
  sessionKey,
  sortLiveSessions
} from './model'

const FAVORITES_KEY = 'hermes.companion.favorites'
const ACTIVE_POLL_MS = 2_000
const HISTORY_POLL_MS = 15_000
const PAGE_SIZE = 200

function initialMode(): CompanionMode {
  const mode = new URLSearchParams(window.location.search).get('mode')

  return mode === 'center' || mode === 'expanded' ? mode : 'island'
}

function readFavorites(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')

    return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function messageText(message: SessionMessage): string {
  const value = message.text ?? message.content

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item : typeof item === 'object' && item ? JSON.stringify(item) : ''))
      .join(' ')
  }

  return value == null ? '' : String(value)
}

function titleFor(session: Pick<SessionInfo, 'id' | 'preview' | 'title'>): string {
  return session.title?.trim() || session.preview?.trim() || session.id.slice(0, 12)
}

function timeAgo(value: number | string | null | undefined): string {
  if (!value) {
    return ''
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : value * (value < 10_000_000_000 ? 1000 : 1)

  if (!Number.isFinite(parsed)) {
    return ''
  }
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))

  if (seconds < 60) {
    return 'now'
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`
  }

  return `${Math.floor(seconds / 86400)}d`
}

async function concurrent<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<number> {
  let cursor = 0
  let failed = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]

        try {
          await worker(item)
        } catch {
          failed += 1
        }
      }
    })
  )

  return failed
}

function StatusDot({ status }: { status: LiveSession['status'] }) {
  return <span aria-label={status} className={`companion-dot companion-dot-${status}`} />
}

function IconTip({ label, children }: { label: string; children: React.ReactElement }) {
  return <Tip label={label}>{children}</Tip>
}

export function CompanionApp() {
  const [mode, setMode] = useState<CompanionMode>(initialMode)
  const [connectedProfiles, setConnectedProfiles] = useState<Set<string>>(new Set())
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [profileTotals, setProfileTotals] = useState<Record<string, number>>({})
  const [profileErrors, setProfileErrors] = useState<Array<{ error: string; profile: string }>>([])
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [profile, setProfile] = useState('all')
  const [favorites, setFavorites] = useState<Set<string>>(readFavorites)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [source, setSource] = useState('')
  const [dataSource, setDataSource] = useState<'legacy' | 'modern'>('modern')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, SessionMessage[]>>({})
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const [legacySessions, setLegacySessions] = useState<LegacySessionInfo[]>([])
  const [legacyTotal, setLegacyTotal] = useState(0)
  const [legacyDetails, setLegacyDetails] = useState<Record<string, LegacySessionDetail>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [displayGeometry, setDisplayGeometry] = useState<{
    hasNotch: boolean
    notchHeight: number
    notchWidth: number
  } | null>(null)
  const gatewaysRef = useRef<Map<string, HermesGateway>>(new Map())
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const changeMode = useCallback(async (next: CompanionMode) => {
    if (next !== 'center') {
      setMode(next)
    }
    await window.hermesDesktop.companion.setMode(next)
  }, [])

  useEffect(() => window.hermesDesktop.companion.onMode(setMode), [])
  useEffect(() => {
    void Promise.all([
      window.hermesDesktop.companion.getState(),
      window.hermesDesktop.companion.getDisplays()
    ]).then(([state, displays]) => {
      const display = displays.find(item => item.id === state.displayId) || displays[0]

      if (display) {
        setDisplayGeometry(display)
      }
    })
  }, [])
  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]))
  }, [favorites])

  const refreshHistory = useCallback(
    async (append = false) => {
      try {
        const offset = append ? sessions.length : 0
        const result = await listAllProfileSessions(PAGE_SIZE, 0, 'include', 'recent', profile, {}, offset)
        setSessions(current => (append ? [...current, ...result.sessions] : result.sessions))
        setSessionTotal(result.total)
        setProfileTotals(current =>
          profile === 'all' ? result.profile_totals || {} : { ...current, ...(result.profile_totals || {}) }
        )
        setProfileErrors(result.errors || [])
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    },
    [profile, sessions.length]
  )

  const refreshLegacy = useCallback(
    async (append = false) => {
      try {
        const offset = append ? legacySessions.length : 0
        const result = await listLegacySessions(PAGE_SIZE, offset, profile, query)
        setLegacySessions(current => (append ? [...current, ...result.sessions] : result.sessions))
        setLegacyTotal(result.total)
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error))
      }
    },
    [legacySessions.length, profile, query]
  )

  useEffect(() => {
    setSelected(new Set())
    void refreshHistory(false)
  }, [profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dataSource === 'legacy') {
      void refreshLegacy(false)
    }
  }, [dataSource, profile, query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null
    const gateways = gatewaysRef.current

    const connectProfile = async (name: string) => {
      const gateway = new HermesGateway()

      try {
        const connection = await window.hermesDesktop.getConnection(name)
        await gateway.connect(await resolveGatewayWsUrl(window.hermesDesktop, connection))

        if (disposed) {
          return gateway.close()
        }
        gateways.set(name, gateway)
        setConnectedProfiles(current => new Set(current).add(name))
      } catch {
        gateway.close()
      }
    }

    const poll = async () => {
      const entries = [...gateways.entries()]
      const results = await Promise.allSettled(
        entries.map(async ([name, gateway]) => {
          const result = await gateway.request<{ sessions?: Omit<LiveSession, 'profile'>[] }>('session.active_list')

          return (result.sessions || []).map(row => ({ ...row, profile: name }))
        })
      )

      if (!disposed) {
        setConnectedProfiles(
          new Set(results.flatMap((result, index) => (result.status === 'fulfilled' ? [entries[index][0]] : [])))
        )
        setLiveSessions(
          sortLiveSessions(results.flatMap(result => (result.status === 'fulfilled' ? result.value : [])))
        )
      }
    }
    void (async () => {
      try {
        const [{ profiles: available }, active] = await Promise.all([getProfiles(), window.hermesDesktop.profile.get()])

        if (disposed) {
          return
        }
        setProfiles(available)

        const configs = await Promise.all(
          available.map(async item => ({
            name: item.name,
            remote: (await window.hermesDesktop.getConnectionConfig(item.name).catch(() => null))?.mode === 'remote'
          }))
        )
        const remoteProfiles = new Set(configs.filter(item => item.remote).map(item => item.name))
        const names = new Set(
          available
            .filter(
              item =>
                item.gateway_running || remoteProfiles.has(item.name) || item.name === (active.profile || 'default')
            )
            .map(item => item.name)
        )

        await Promise.allSettled([...names].map(connectProfile))
        await poll()
        timer = setInterval(() => void poll(), ACTIVE_POLL_MS)
      } catch {
        setConnectedProfiles(new Set())
      }
    })()

    const historyTimer = setInterval(() => void refreshHistory(false), HISTORY_POLL_MS)

    return () => {
      disposed = true

      if (timer) {
        clearInterval(timer)
      }
      clearInterval(historyTimer)

      for (const gateway of gateways.values()) {
        gateway.close()
      }
      gateways.clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const liveKeys = useMemo(() => {
    const keys = new Set<string>()

    for (const live of liveSessions) {
      keys.add(sessionKey(live.profile, live.id))
      keys.add(sessionKey(live.profile, live.session_key))
    }

    return keys
  }, [liveSessions])

  const compactRows = useMemo(() => {
    const live = liveSessions.filter(session => session.status !== 'idle')

    const favoriteRows: LiveSession[] = sessions
      .filter(session => favorites.has(favoriteKey(session)) && !liveKeys.has(sessionKey(session.profile, session.id)))
      .map(session => ({
        id: session.id,
        profile: session.profile || 'default',
        session_key: session.id,
        title: titleFor(session),
        preview: session.preview || '',
        model: session.model || '',
        message_count: session.message_count,
        last_active: session.last_active,
        started_at: session.started_at,
        status: 'idle'
      }))

    return [...live, ...favoriteRows].slice(0, 6)
  }, [favorites, liveKeys, liveSessions, sessions])

  const visibleSessions = useMemo(
    () => filterSessions(sessions, liveKeys, favorites, query, filter, source, profile),
    [favorites, filter, liveKeys, profile, query, sessions, source]
  )

  const sources = useMemo(() => [...new Set(sessions.map(session => session.source || 'desktop'))].sort(), [sessions])

  const toggleFavorite = (session: SessionInfo) => {
    const key = favoriteKey(session)
    setFavorites(current => {
      const next = new Set(current)
      next.has(key) ? next.delete(key) : next.add(key)

      return next
    })
  }

  const loadMessages = async (session: SessionInfo) => {
    const key = sessionKey(session.profile, session.id)

    if (expandedId === key) {
      return setExpandedId(null)
    }
    setExpandedId(key)

    if (messages[key]) {
      return
    }

    try {
      const [detail, summary] = await Promise.all([
        getSessionMessages(session.id, session.profile),
        getSessionSummary(session.id, session.profile)
      ])

      setMessages(current => ({ ...current, [key]: detail.messages.slice(-12) }))

      if (summary.summary) {
        setSummaries(current => ({ ...current, [key]: summary.summary || '' }))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const loadLegacyDetail = async (session: LegacySessionInfo) => {
    const key = sessionKey(session.profile, session.id)

    if (expandedId === key) {
      return setExpandedId(null)
    }
    setExpandedId(key)

    if (legacyDetails[key]) {
      return
    }

    try {
      const detail = await getLegacySession(session.profile, session.id)
      setLegacyDetails(current => ({ ...current, [key]: detail }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const archiveMany = async (rows: SessionInfo[], archived: boolean) => {
    setBusy(true)

    const failed = await concurrent(rows, 5, row =>
      setSessionArchived(row.id, archived, row.profile).then(() => undefined)
    )

    setNotice(failed ? `${rows.length - failed} updated, ${failed} failed` : `${rows.length} updated`)
    setSelected(new Set())
    await refreshHistory(false)
    setBusy(false)
  }

  const deleteMany = async (rows: SessionInfo[]) => {
    const allowedRows = rows.filter(row => !liveKeys.has(sessionKey(row.profile, row.id)))

    if (allowedRows.length !== rows.length) {
      setNotice(`${rows.length - allowedRows.length} active session(s) protected`)
    }

    if (
      !allowedRows.length ||
      !window.confirm(`Permanently delete ${allowedRows.length} session(s)? This cannot be undone.`)
    ) {
      return
    }

    setBusy(true)
    const groups = new Map<string, SessionInfo[]>()

    for (const row of allowedRows) {
      const owner = row.profile || 'default'
      groups.set(owner, [...(groups.get(owner) || []), row])
    }

    const failed = await concurrent([...groups.entries()], 3, async ([owner, group]) => {
      await window.hermesDesktop.api({
        profile: owner,
        path: '/api/sessions/bulk-delete',
        method: 'POST',
        body: { ids: group.map(row => row.id) }
      })
    })

    setNotice(failed ? `Delete failed for ${failed} profile group(s)` : `${allowedRows.length} deleted`)
    setSelected(new Set())
    await refreshHistory(false)
    setBusy(false)
  }

  const deleteLegacy = async (session: LegacySessionInfo) => {
    if (!window.confirm(`Permanently delete legacy JSON session “${session.title || session.id}”?`)) {
      return
    }
    setBusy(true)

    try {
      await deleteLegacySession(session.profile, session.id)
      await refreshLegacy(false)
      setNotice('Legacy JSON session deleted')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (session: SessionInfo) => {
    const next = window.prompt('Session title', session.title || '')

    if (next == null || next.trim() === (session.title || '')) {
      return
    }
    setBusy(true)

    try {
      await renameSession(session.id, next.trim(), session.profile)
      await refreshHistory(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const enter = () => {
    const transition = hoverTransition(mode, 'enter', busy)

    if (!transition) {
      return
    }

    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
    }
    closeTimer.current = setTimeout(() => void changeMode(transition.mode), transition.delay)
  }

  const leave = () => {
    const transition = hoverTransition(mode, 'leave', busy)

    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
    }

    if (transition) {
      closeTimer.current = setTimeout(() => void changeMode(transition.mode), transition.delay)
    }
  }

  const selectedRows = sessions.filter(session => selected.has(sessionKey(session.profile, session.id)))
  const rows = dataSource === 'modern' ? visibleSessions : legacySessions

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 82,
    getScrollElement: () => listRef.current,
    overscan: 8
  })

  if (mode !== 'center') {
    const running = liveSessions.filter(session => session.status !== 'idle')
    const collapsedWidth = displayGeometry?.hasNotch ? Math.max(180, displayGeometry.notchWidth) : 330
    const collapsedHeight = displayGeometry?.hasNotch ? Math.max(24, displayGeometry.notchHeight) : 38

    return (
      <main className="companion-overlay">
        <motion.section
          animate={{
            borderBottomLeftRadius: mode === 'expanded' ? 22 : 15,
            borderBottomRightRadius: mode === 'expanded' ? 22 : 15,
            height: mode === 'expanded' ? 390 : collapsedHeight,
            width: mode === 'expanded' ? 520 : collapsedWidth
          }}
          className={`companion-shell companion-notch companion-${mode}`}
          onContextMenu={event => {
            event.preventDefault()
            void window.hermesDesktop.companion.showContextMenu()
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          transition={{ damping: 30, mass: 0.72, stiffness: 360, type: 'spring' }}
        >
          <header className="companion-island-header">
            <div className="companion-brand">
              <span className="companion-orb" />
              Hermes
            </div>
            <div className="companion-summary">
              {!connectedProfiles.size ? 'Offline' : running.length ? `${running.length} active` : 'Ready'}
            </div>
            <IconTip label="Open Session Center">
              <Button
                aria-label="Open Session Center"
                onClick={() => void changeMode('center')}
                size="icon"
                variant="ghost"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </IconTip>
          </header>
          <AnimatePresence>
            {mode === 'expanded' && (
              <motion.section
                animate={{ opacity: 1, y: 0 }}
                className="companion-compact-list"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: -8 }}
                transition={{ delay: 0.04, duration: 0.16 }}
              >
                {compactRows.length ? (
                  compactRows.map(session => (
                    <button
                      className="companion-compact-row"
                      key={sessionKey(session.profile, session.session_key)}
                      onClick={() => void window.hermesDesktop.openSessionWindow(session.session_key, session.profile)}
                      type="button"
                    >
                      <StatusDot status={session.status} />
                      <span className="min-w-0 flex-1">
                        <strong>{session.title || session.preview || session.session_key.slice(0, 12)}</strong>
                        <small>
                          {session.profile} · {session.preview || session.model || session.status}
                        </small>
                      </span>
                      <time>{timeAgo(session.last_active)}</time>
                    </button>
                  ))
                ) : (
                  <div className="companion-empty">No active or favorite sessions</div>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </motion.section>
      </main>
    )
  }

  return (
    <main className="companion-shell companion-center">
      <header className="companion-center-header">
        <div>
          <p className="companion-eyebrow">HERMES COMPANION</p>
          <h1>Session Center</h1>
        </div>
        <div className="companion-header-actions">
          <span className={connectedProfiles.size ? 'companion-online' : 'companion-offline'}>
            {connectedProfiles.size ? `${connectedProfiles.size} profile gateway(s)` : 'Gateways offline'}
          </span>
          <IconTip label="Close Session Center">
            <Button aria-label="Close Session Center" onClick={() => window.close()} size="icon" variant="ghost">
              <X className="size-4" />
            </Button>
          </IconTip>
        </div>
      </header>

      <section className="companion-source-tabs">
        <button
          className={dataSource === 'modern' ? 'is-active' : ''}
          onClick={() => setDataSource('modern')}
          type="button"
        >
          Database sessions
        </button>
        <button
          className={dataSource === 'legacy' ? 'is-active' : ''}
          onClick={() => setDataSource('legacy')}
          type="button"
        >
          Legacy JSON
        </button>
      </section>

      <section className="companion-toolbar">
        <label className="companion-search">
          <Search className="size-4" />
          <input
            onChange={event => setQuery(event.target.value)}
            placeholder="Search title, preview, ID…"
            value={query}
          />
        </label>
        <select onChange={event => setProfile(event.target.value)} value={profile}>
          <option value="all">
            All profiles ({Object.values(profileTotals).reduce((sum, count) => sum + count, 0)})
          </option>
          {profiles.map(item => (
            <option key={item.name} value={item.name}>
              {item.name} ({profileTotals[item.name] || 0})
            </option>
          ))}
        </select>
        {dataSource === 'modern' && (
          <>
            <select onChange={event => setFilter(event.target.value as SessionFilter)} value={filter}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="favorites">Favorites</option>
              <option value="archived">Archived</option>
            </select>
            <select onChange={event => setSource(event.target.value)} value={source}>
              <option value="">All sources</option>
              {sources.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="companion-count">{dataSource === 'modern' ? sessionTotal : legacyTotal} sessions</span>
      </section>

      {selectedRows.length > 0 && dataSource === 'modern' && (
        <section className="companion-bulkbar">
          <strong>{selectedRows.length} selected</strong>
          <Button
            className="companion-danger"
            disabled={busy}
            onClick={() => void archiveMany(selectedRows, true)}
            size="sm"
            variant="ghost"
          >
            <Archive className="size-3.5" /> Archive
          </Button>
          <Button disabled={busy} onClick={() => void archiveMany(selectedRows, false)} size="sm" variant="ghost">
            <ArchiveOff className="size-3.5" /> Restore
          </Button>
          <Button
            className="companion-danger"
            disabled={busy}
            onClick={() => void deleteMany(selectedRows)}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </section>
      )}

      {(notice || profileErrors.length > 0) && (
        <button className="companion-notice" onClick={() => setNotice('')} type="button">
          {notice || profileErrors.map(error => `${error.profile}: ${error.error}`).join(' · ')}
        </button>
      )}

      <section className="companion-session-list" ref={listRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index]

            return (
              <div
                data-index={item.index}
                key={sessionKey(row.profile, row.id)}
                ref={virtualizer.measureElement}
                style={{
                  left: 0,
                  position: 'absolute',
                  top: 0,
                  transform: `translateY(${item.start}px)`,
                  width: '100%'
                }}
              >
                {'legacy_json' in row ? (
                  <LegacyRow
                    busy={busy}
                    detail={legacyDetails[sessionKey(row.profile, row.id)]}
                    expanded={expandedId === sessionKey(row.profile, row.id)}
                    onDelete={() => void deleteLegacy(row)}
                    onExpand={() => void loadLegacyDetail(row)}
                    session={row}
                  />
                ) : (
                  <ModernRow
                    active={liveKeys.has(sessionKey(row.profile, row.id))}
                    busy={busy}
                    expanded={expandedId === sessionKey(row.profile, row.id)}
                    favorite={favorites.has(favoriteKey(row))}
                    messages={messages[sessionKey(row.profile, row.id)]}
                    onArchive={() => void archiveMany([row], !row.archived)}
                    onDelete={() => void deleteMany([row])}
                    onExpand={() => void loadMessages(row)}
                    onFavorite={() => toggleFavorite(row)}
                    onRename={() => void rename(row)}
                    onSelect={checked =>
                      setSelected(current => {
                        const next = new Set(current)
                        const key = sessionKey(row.profile, row.id)
                        checked ? next.add(key) : next.delete(key)

                        return next
                      })
                    }
                    selected={selected.has(sessionKey(row.profile, row.id))}
                    session={row}
                    summary={summaries[sessionKey(row.profile, row.id)]}
                  />
                )}
              </div>
            )
          })}
        </div>
        {!rows.length && <div className="companion-empty companion-empty-large">No sessions match these filters.</div>}
        {rows.length < (dataSource === 'modern' ? sessionTotal : legacyTotal) && (
          <Button
            className="companion-load-more"
            disabled={busy}
            onClick={() => void (dataSource === 'modern' ? refreshHistory(true) : refreshLegacy(true))}
            variant="outline"
          >
            Load more
          </Button>
        )}
      </section>
    </main>
  )
}

function ModernRow(props: {
  active: boolean
  busy: boolean
  expanded: boolean
  favorite: boolean
  messages?: SessionMessage[]
  onArchive: () => void
  onDelete: () => void
  onExpand: () => void
  onFavorite: () => void
  onRename: () => void
  onSelect: (checked: boolean) => void
  selected: boolean
  session: SessionInfo
  summary?: string
}) {
  const { session } = props

  return (
    <article className={`companion-session-card ${session.archived ? 'is-archived' : ''}`}>
      <div className="companion-session-row">
        <input
          aria-label={`Select ${titleFor(session)}`}
          checked={props.selected}
          onChange={event => props.onSelect(event.target.checked)}
          type="checkbox"
        />
        <button aria-label="Show recent messages" className="companion-expand" onClick={props.onExpand} type="button">
          {props.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="companion-session-main">
          <div className="companion-session-title">
            {props.active && <StatusDot status="working" />}
            <strong>{titleFor(session)}</strong>
            <span className="companion-profile-badge">{session.profile || 'default'}</span>
            {session.archived && <span className="companion-badge">archived</span>}
          </div>
          <p>{session.preview || 'No preview'}</p>
          <small>
            {session.source || 'desktop'} · {session.message_count} messages · {timeAgo(session.last_active)} ·{' '}
            {session.id.slice(0, 12)}
          </small>
        </div>
        <div className="companion-row-actions">
          <IconTip label={props.favorite ? 'Remove from favorites' : 'Add to favorites'}>
            <Button aria-label="Favorite" onClick={props.onFavorite} size="icon" variant="ghost">
              <Pin className={`size-4 ${props.favorite ? 'fill-current text-amber-400' : ''}`} />
            </Button>
          </IconTip>
          <IconTip label="Open in chat window">
            <Button
              aria-label="Open"
              onClick={() => void window.hermesDesktop.openSessionWindow(session.id, session.profile)}
              size="icon"
              variant="ghost"
            >
              <ExternalLink className="size-4" />
            </Button>
          </IconTip>
          <IconTip label="Rename session">
            <Button aria-label="Rename" onClick={props.onRename} size="icon" variant="ghost">
              <MoreHorizontal className="size-4" />
            </Button>
          </IconTip>
          <IconTip label={session.archived ? 'Restore archived session' : 'Archive session'}>
            <Button
              aria-label={session.archived ? 'Restore' : 'Archive'}
              className={session.archived ? '' : 'companion-danger'}
              disabled={props.busy}
              onClick={props.onArchive}
              size="icon"
              variant="ghost"
            >
              {session.archived ? <ArchiveOff className="size-4" /> : <Archive className="size-4" />}
            </Button>
          </IconTip>
          <IconTip label={props.active ? 'Active sessions cannot be deleted' : 'Permanently delete'}>
            <Button
              aria-label={props.active ? 'Active sessions cannot be deleted' : 'Delete'}
              className="companion-danger"
              disabled={props.busy || props.active}
              onClick={props.onDelete}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </IconTip>
        </div>
      </div>
      {props.expanded && (
        <div className="companion-messages">
          {props.summary && (
            <div className="companion-summary-card">
              <strong>Compaction summary</strong>
              <p>{props.summary}</p>
            </div>
          )}
          {!props.messages ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            props.messages.map((message, index) => (
              <div className={`companion-message companion-message-${message.role}`} key={`${message.role}:${index}`}>
                <strong>{message.role}</strong>
                <p>{messageText(message).slice(0, 1200) || 'Empty message'}</p>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  )
}

function LegacyRow(props: {
  busy: boolean
  detail?: LegacySessionDetail
  expanded: boolean
  onDelete: () => void
  onExpand: () => void
  session: LegacySessionInfo
}) {
  const { session } = props

  return (
    <article className="companion-session-card companion-legacy-card">
      <div className="companion-session-row">
        <button aria-label="Show recent messages" className="companion-expand" onClick={props.onExpand} type="button">
          {props.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="companion-session-main">
          <div className="companion-session-title">
            <strong>{session.title || session.id}</strong>
            <span className="companion-profile-badge">{session.profile}</span>
            <span className="companion-badge">JSON only</span>
          </div>
          <p>{session.summary || session.preview || 'No preview'}</p>
          <small>
            {session.source} · {session.message_count} messages · {timeAgo(session.last_active)} ·{' '}
            {session.id.slice(0, 12)}
          </small>
        </div>
        <IconTip label="Permanently delete JSON transcript">
          <Button
            aria-label="Delete legacy JSON session"
            className="companion-danger"
            disabled={props.busy}
            onClick={props.onDelete}
            size="icon"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        </IconTip>
      </div>
      {props.expanded && (
        <div className="companion-messages">
          {session.summary && (
            <div className="companion-summary-card">
              <strong>Compaction summary</strong>
              <p>{session.summary}</p>
            </div>
          )}
          {!props.detail ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            props.detail.messages.slice(-12).map((message, index) => (
              <div className={`companion-message companion-message-${message.role}`} key={`${message.role}:${index}`}>
                <strong>{message.role}</strong>
                <p>{messageText(message).slice(0, 1200) || 'Empty message'}</p>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  )
}
