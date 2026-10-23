import assert from 'node:assert/strict'
import test from 'node:test'
import { trackPeople } from '../src/counterTracking.js'

const person = (centerY, score = 0.9) => ({ class: 'person', score, bbox: [100, centerY - 72, 40, 100] })
const options = (now, overrides = {}) => ({
  now,
  orientation: 'horizontal',
  width: 640,
  height: 400,
  linePosition: 55,
  confidenceThreshold: 0.4,
  enteringDirection: 'down',
  ...overrides,
})

function frame(detections, now, tracks = new Map(), nextTrackId = 1, overrides = {}) {
  return trackPeople(detections, tracks, nextTrackId, options(now, overrides))
}

test('tracks people across the line and counts a boarding after three observations', () => {
  let result = frame([person(180)], 0)
  result = frame([person(190)], 100, result.tracks, result.nextTrackId)
  result = frame([person(240)], 200, result.tracks, result.nextTrackId)

  assert.equal(result.boarding, 1)
  assert.equal(result.alighting, 0)
  assert.equal(result.people[0].trackId, 1)
  assert.equal(result.confidenceCount, 1)
})

test('applies confidence filtering and configurable crossing direction', () => {
  const lowConfidence = frame([person(180, 0.3)], 0)
  assert.equal(lowConfidence.people.length, 0)
  assert.equal(lowConfidence.tracks.size, 0)

  let result = frame([person(240)], 0, new Map(), 1, { enteringDirection: 'up' })
  result = frame([person(190)], 100, result.tracks, result.nextTrackId, { enteringDirection: 'up' })
  result = frame([person(180)], 200, result.tracks, result.nextTrackId, { enteringDirection: 'up' })

  assert.equal(result.boarding, 1)
  assert.equal(result.alighting, 0)
})
