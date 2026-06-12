import type { SessionInfo } from '@/types/hermes'

export type LiveSessionStatus = 'idle' | 'starting' | 'waiting' | 'working'

export interface LiveSession {
  id: string
  last_active: number
  message_count: number
  model: string
  profile: string
  preview: string
  session_key: string
  started_at: number
  status: LiveSessionStatus
  title: string
}

export type SessionFilter = 'active' | 'all' | 'archived' | 'favorites'
export type CompanionHoverEvent = 'enter' | 'leave'
export type CompanionMode = 'center' | 'expanded' | 'island'

export const durableSessionId = (session: Pick<SessionInfo, '_lineage_root_id' | 'id'>): string =>
  session._lineage_root_id || session.id

export const favoriteKey = (session: Pick<SessionInfo, '_lineage_root_id' | 'id' | 'profile'>): string =>
  `${session.profile || 'default'}:${durableSessionId(session)}`

export const sessionKey = (profile: null | string | undefined, id: string): string => `${profile || 'default'}:${id}`

export function liveStatusRank(status: LiveSessionStatus): number {
  return { waiting: 0, working: 1, starting: 2, idle: 3 }[status]
}

export function sortLiveSessions(sessions: LiveSession[]): LiveSession[] {
  return [...sessions].sort(
    (left, right) => liveStatusRank(left.status) - liveStatusRank(right.status) || right.last_active - left.last_active
  )
}

export function filterSessions(
  sessions: SessionInfo[],
  liveKeys: ReadonlySet<string>,
  favorites: ReadonlySet<string>,
  query: string,
  filter: SessionFilter,
  source: string,
  profile = 'all'
): SessionInfo[] {
  const needle = query.trim().toLowerCase()

  return sessions.filter(session => {
    const live =
      liveKeys.has(sessionKey(session.profile, session.id)) ||
      liveKeys.has(sessionKey(session.profile, durableSessionId(session)))

    const favorite = favorites.has(favoriteKey(session))

    if (filter === 'active' && !live) {
      return false
    }

    if (filter === 'archived' && !session.archived) {
      return false
    }

    if (filter === 'favorites' && !favorite) {
      return false
    }

    if (source && (session.source || 'desktop') !== source) {
      return false
    }

    if (profile !== 'all' && (session.profile || 'default') !== profile) {
      return false
    }

    if (!needle) {
      return true
    }

    return [session.title, session.preview, session.id, session.source, session.profile]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(needle))
  })
}

export function deletableSessionIds(selected: Iterable<string>, activeIds: ReadonlySet<string>): string[] {
  return [...selected].filter(id => !activeIds.has(id))
}

export function hoverTransition(
  mode: CompanionMode,
  event: CompanionHoverEvent,
  busy: boolean
): { delay: number; mode: CompanionMode } | null {
  if (mode === 'island' && event === 'enter') {
    return { delay: 120, mode: 'expanded' }
  }

  if (mode === 'expanded' && event === 'leave' && !busy) {
    return { delay: 450, mode: 'island' }
  }

  return null
}
