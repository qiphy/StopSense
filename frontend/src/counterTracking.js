const TRACK_MATCH_DISTANCE = 0.2
const TRACK_STALE_MS = 2000
const TRACK_COOLDOWN_MS = 3500

export function trackPeople(detections, tracks, nextTrackId, options) {
  const { now, orientation, width, height, linePosition, confidenceThreshold, enteringDirection } = options
  const axisLength = orientation === 'horizontal' ? height : width
  const line = axisLength * linePosition / 100
  const padding = Math.max(14, axisLength * 0.035)
  const crossingDistance = Math.max(30, axisLength * 0.11)
  const matchDistance = Math.max(45, Math.min(width, height) * TRACK_MATCH_DISTANCE)
  const people = detections
    .filter((item) => item.class === 'person' && item.score >= confidenceThreshold)
    .sort((a, b) => b.score - a.score)
  const used = new Set()
  const updatedTracks = new Map(tracks)
  let boarding = 0
  let alighting = 0
  let confidenceSum = 0
  let confidenceCount = 0
  let lastCrossingAt = null
  const positiveDirectionIsEntry = enteringDirection === 'down' || enteringDirection === 'right'

  for (const detection of people) {
    const [x, y, boxWidth, boxHeight] = detection.bbox
    const center = { x: x + boxWidth / 2, y: y + boxHeight * 0.72 }
    const coordinate = orientation === 'horizontal' ? center.y : center.x
    let closest
    let closestDistance = matchDistance
    for (const candidate of updatedTracks.values()) {
      if (used.has(candidate.id) || now - candidate.lastSeen > 700) continue
      const distance = Math.hypot(center.x - candidate.center.x, center.y - candidate.center.y)
      if (distance < closestDistance) {
        closest = candidate
        closestDistance = distance
      }
    }

    const track = closest || {
      id: nextTrackId++, frames: 0, side: null, anchor: coordinate,
      center, bbox: detection.bbox, confidence: detection.score, lastSeen: now,
      lastCountAt: 0,
    }
    track.center = center
    track.bbox = detection.bbox
    track.confidence = detection.score
    track.frames += 1
    track.lastSeen = now
    used.add(track.id)

    if (track.side === null) {
      if (coordinate < line - padding) track.side = 'before'
      else if (coordinate > line + padding) track.side = 'after'
      track.anchor = coordinate
    } else {
      const movedEnough = Math.abs(coordinate - track.anchor) >= crossingDistance
      const cooldownDone = !track.lastCountAt || now - track.lastCountAt > TRACK_COOLDOWN_MS
      let crossingDirection = null
      if (track.frames >= 3 && movedEnough && cooldownDone && track.side === 'before' && coordinate > line + padding) {
        crossingDirection = 'forward'
        track.side = 'after'
        track.anchor = coordinate
      } else if (track.frames >= 3 && movedEnough && cooldownDone && track.side === 'after' && coordinate < line - padding) {
        crossingDirection = 'backward'
        track.side = 'before'
        track.anchor = coordinate
      }
      if (crossingDirection) {
        const isBoarding = (crossingDirection === 'forward') === positiveDirectionIsEntry
        if (isBoarding) boarding += 1
        else alighting += 1
        confidenceSum += detection.score
        confidenceCount += 1
        track.lastCountAt = now
        lastCrossingAt = now
      }
    }
    updatedTracks.set(track.id, track)
    detection.trackId = track.id
  }

  for (const [id, track] of updatedTracks) {
    if (now - track.lastSeen > TRACK_STALE_MS) updatedTracks.delete(id)
  }
  return { people, tracks: updatedTracks, nextTrackId, boarding, alighting, confidenceSum, confidenceCount, lastCrossingAt }
}
