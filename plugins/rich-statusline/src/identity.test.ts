import { describe, expect, test } from 'claude-code/testing'
import { effortOf, withCwd, withSession, withStep } from './identity'

const HELD = { model: 'claude-opus-5-5', cwd: '/a', home: '/h', effort: 'high' }

describe('identity updates', () => {
  test('a step effort wins over the configured one', () => {
    expect(withSession(HELD, { model: 'm', cwd: '/b', configuredEffort: 'low' }).effort).toBe('high')
    expect(withSession(null, { model: 'm', cwd: '/b', configuredEffort: 'low' })).toEqual({ model: 'm', cwd: '/b', effort: 'low' })
  })
  test('a step without effort clears it, keeping where we are', () => {
    expect(withStep(HELD, { model: 'claude-sonnet-4-5' })).toEqual({ model: 'claude-sonnet-4-5', cwd: '/a', home: '/h' })
    expect(withStep(null, { model: 'x', effort: 'medium' })).toEqual({ model: 'x', cwd: '', effort: 'medium' })
  })
  test('numeric efforts read as text, others not at all', () => {
    expect(effortOf(32000)).toBe('32000')
    expect(effortOf({})).toBeUndefined()
  })
  test('cwd changes only a known identity', () => {
    expect(withCwd(HELD, '/z')?.cwd).toBe('/z')
    expect(withCwd(null, '/z')).toBeNull()
  })
})
