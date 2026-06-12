import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import {
  deletableSessionIds,
  favoriteKey,
  filterSessions,
  hoverTransition,
  sessionKey,
  sortLiveSessions
} from './model'

const session = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  archived: false,
  ended_at: 1,
  id,
  input_tokens: 0,
  is_active: false,
  last_active: 1,
  message_count: 2,
  model: null,
  output_tokens: 0,
  preview: `preview ${id}`,
  source: 'desktop',
  started_at: 1,
  title: `title ${id}`,
  tool_call_count: 0,
  ...extra
})

describe('companion model', () => {
  it('keys favorites by profile and durable lineage id', () => {
    expect(favoriteKey(session('tip', { _lineage_root_id: 'root', profile: 'work' }))).toBe('work:root')
    expect(sessionKey('life', 'same-id')).toBe('life:same-id')
  })

  it('sorts waiting and working sessions before idle sessions', () => {
    const rows = sortLiveSessions([
      {
        id: 'idle',
        last_active: 3,
        message_count: 0,
        model: '',
        profile: 'default',
        preview: '',
        session_key: 'idle',
        started_at: 1,
        status: 'idle',
        title: ''
      },
      {
        id: 'work',
        last_active: 1,
        message_count: 0,
        model: '',
        profile: 'work',
        preview: '',
        session_key: 'work',
        started_at: 1,
        status: 'working',
        title: ''
      },
      {
        id: 'wait',
        last_active: 2,
        message_count: 0,
        model: '',
        profile: 'life',
        preview: '',
        session_key: 'wait',
        started_at: 1,
        status: 'waiting',
        title: ''
      }
    ])

    expect(rows.map(row => row.id)).toEqual(['wait', 'work', 'idle'])
  })

  it('filters by search, favorite and source', () => {
    const rows = [session('a', { profile: 'default' }), session('b', { source: 'telegram', title: 'Release' })]
    expect(filterSessions(rows, new Set(), new Set(['default:a']), '', 'favorites', '')).toHaveLength(1)
    expect(filterSessions(rows, new Set(), new Set(), 'release', 'all', 'telegram')[0]?.id).toBe('b')
  })

  it('protects active sessions from deletion', () => {
    expect(deletableSessionIds(['a', 'b'], new Set(['b']))).toEqual(['a'])
  })

  it('delays hover expansion and pauses collapse while busy', () => {
    expect(hoverTransition('island', 'enter', false)).toEqual({ delay: 120, mode: 'expanded' })
    expect(hoverTransition('expanded', 'leave', true)).toBeNull()
    expect(hoverTransition('expanded', 'leave', false)).toEqual({ delay: 450, mode: 'island' })
  })
})
