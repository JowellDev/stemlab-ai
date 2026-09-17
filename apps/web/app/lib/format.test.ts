import { describe, expect, it } from 'vitest'
import { formatTime, formatTimePrecise } from './format'

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.9, '0:59'],
    [60, '1:00'],
    [125, '2:05'],
    [3600, '60:00'],
  ])('formate %s en %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('retombe sur 0:00 pour %s', (input) => {
    expect(formatTime(input)).toBe('0:00')
  })
})

describe('formatTimePrecise', () => {
  it.each([
    [0, '0:00.0'],
    [5.25, '0:05.3'],
    [61.04, '1:01.0'],
    [125.96, '2:06.0'],
  ])('formate %s en %s', (input, expected) => {
    expect(formatTimePrecise(input)).toBe(expected)
  })

  it('conserve deux chiffres de secondes', () => {
    expect(formatTimePrecise(63.5)).toBe('1:03.5')
  })

  it.each([Number.NaN, -3])('retombe sur 0:00.0 pour %s', (input) => {
    expect(formatTimePrecise(input)).toBe('0:00.0')
  })
})
