import { useEffect, useRef, useState } from 'react'

type Counts = { boarding: number; alighting: number; occupancy: number }
type Track = { id: number; x: number; y: number; side: -1 | 0 | 1; lastFrame: number }

const LINE = 0.55
const HYSTERESIS = 12
const CAMERA_ID = 'browser-camera-01'

export default function LiveCameraCounter({ apiUrl }: { apiUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const mountedRef = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const tracksRef = useRef<Track[]>([])
  const nextTrackIdRef = useRef(1)
  const frameRef = useRef(0)
  const countsRef = useRef<Counts>({ boarding: 0, alighting: 0, occupancy: 0 })
  const confidenceRef = useRef({ sum: 0, count: 0 })
  const [counts, setCounts] = useState<Counts>(countsRef.current)
  const [state, setState] = useState<'idle' | 'starting' | 'active' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [initialOccupancy, setInitialOccupancy] = useState(0)
  const [enteringDirection, setEnteringDirection] = useState<'down' | 'up'>('down')

  const publish = async (status: 'ok' | 'offline') => {
    const metrics = confidenceRef.current
    try {
      const response = await fetch(`${apiUrl}/passenger-counts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: CAMERA_ID,
          observed_at: new Date().toISOString(),
          boarding_count: countsRef.current.boarding,
          alighting_count: countsRef.current.alighting,
          occupancy_count: countsRef.current.occupancy,
          confidence: metrics.count ? metrics.sum / metrics.count : 0,
          status,
        }),
      })
      if (!response.ok) throw new Error(`Count API returned ${response.status}`)
      if (mountedRef.current) setMessage('Live detection · counts sent to Operations')
    } catch {
      if (mountedRef.current) setMessage('Live detection · could not send counts to the API')
    }
  }

  const stopCamera = async () => {
    runningRef.current = false
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (state === 'active') await publish('offline')
    setState('idle')
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera access requires a secure page (HTTPS or localhost) and a supported browser')
      setState('error')
      return
    }
    setState('starting')
    setMessage('Requesting camera permission…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if (!videoRef.current) throw new Error('Camera preview is not available')
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setMessage('Loading the local person detector…')
      const tf = await import('@tensorflow/tfjs-core')
      await import('@tensorflow/tfjs-backend-webgl')
      await import('@tensorflow/tfjs-backend-cpu')
      try {
        if (!await tf.setBackend('webgl')) await tf.setBackend('cpu')
      } catch {
        await tf.setBackend('cpu')
      }
      await tf.ready()
      const cocoSsd = await import('@tensorflow-models/coco-ssd')
      const model = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
      if (!mountedRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        return
      }
      countsRef.current = { boarding: 0, alighting: 0, occupancy: Math.max(0, Math.floor(initialOccupancy)) }
      setCounts(countsRef.current)
      tracksRef.current = []
      nextTrackIdRef.current = 1
      frameRef.current = 0
      confidenceRef.current = { sum: 0, count: 0 }
      runningRef.current = true
      setState('active')
      await publish('ok')

      const detect = async () => {
        const video = videoRef.current
        if (!runningRef.current || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
        try {
          const detections = await model.detect(video, 20, 0.5)
          const frame = ++frameRef.current
          const centerLimit = Math.max(video.videoWidth, video.videoHeight) * 0.16
          const current = tracksRef.current.filter((track) => frame - track.lastFrame <= 3)
          const used = new Set<number>()
          const next: Track[] = []
          const nextCounts = { ...countsRef.current }

          for (const detection of detections.filter((item) => item.class === 'person')) {
            const [x, y, width, height] = detection.bbox
            const centerX = x + width / 2
            const centerY = y + height / 2
            const side: -1 | 0 | 1 = centerY < LINE * video.videoHeight - HYSTERESIS ? -1 : centerY > LINE * video.videoHeight + HYSTERESIS ? 1 : 0
            let closest: Track | undefined
            let closestDistance = centerLimit
            for (const track of current) {
              if (used.has(track.id)) continue
              const distance = Math.hypot(centerX - track.x, centerY - track.y)
              if (distance < closestDistance) {
                closest = track
                closestDistance = distance
              }
            }

            if (!closest) {
              next.push({ id: nextTrackIdRef.current++, x: centerX, y: centerY, side, lastFrame: frame })
              continue
            }

            used.add(closest.id)
            let updatedSide = closest.side
            if (side && closest.side && side !== closest.side) {
              const entering = enteringDirection === 'down' ? closest.side < side : closest.side > side
              if (entering) {
                nextCounts.boarding += 1
                nextCounts.occupancy += 1
              } else {
                nextCounts.alighting += 1
                nextCounts.occupancy = Math.max(0, nextCounts.occupancy - 1)
              }
              confidenceRef.current.sum += detection.score
              confidenceRef.current.count += 1
              updatedSide = side
            } else if (side) {
              updatedSide = side
            }
            next.push({ id: closest.id, x: centerX, y: centerY, side: updatedSide, lastFrame: frame })
          }

          tracksRef.current = next
          if (nextCounts.boarding !== countsRef.current.boarding || nextCounts.alighting !== countsRef.current.alighting || nextCounts.occupancy !== countsRef.current.occupancy) {
            countsRef.current = nextCounts
            setCounts(nextCounts)
          }
          if (frame % 7 === 0) void publish('ok')
        } catch {
          if (mountedRef.current) setMessage('Person detection failed; check browser support and reload the page')
        }
        if (runningRef.current) timerRef.current = window.setTimeout(detect, 300)
      }
      void detect()
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      if (mountedRef.current) {
        setState('error')
        setMessage(error instanceof Error ? error.message : 'Could not start the camera')
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runningRef.current = false
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <div className="live-camera">
      <div className="live-camera-heading">
        <div><strong>Live webcam · local detection</strong><span>Camera video stays in this browser</span></div>
        <label>Enters moving <select aria-label="Entering direction" value={enteringDirection} disabled={state === 'active' || state === 'starting'} onChange={(event) => setEnteringDirection(event.target.value as 'down' | 'up')}><option value="down">Down</option><option value="up">Up</option></select></label>
        <label>Starting occupancy <input aria-label="Starting occupancy" type="number" min="0" step="1" value={initialOccupancy} disabled={state === 'active' || state === 'starting'} onChange={(event) => setInitialOccupancy(Math.max(0, Number(event.target.value) || 0))} /></label>
      </div>
      <div className="live-video-wrap">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Live webcam preview" />
        {state !== 'active' && <div className="live-video-empty">{state === 'starting' ? 'Starting camera and detector…' : 'Camera is off'}</div>}
        {state === 'active' && <div className="live-count-line" style={{ top: `${LINE * 100}%` }}><span>COUNTING LINE</span></div>}
      </div>
      <div className="live-camera-controls">
        <div className="live-local-counts"><span>Boarding <strong>{counts.boarding}</strong></span><span>Alighting <strong>{counts.alighting}</strong></span><span>Occupancy <strong>{counts.occupancy}</strong></span></div>
        <button type="button" disabled={state === 'starting'} onClick={state === 'active' ? stopCamera : startCamera}>{state === 'active' ? 'Stop webcam' : state === 'starting' ? 'Starting…' : 'Start webcam'}</button>
      </div>
      <small className="live-camera-message" role="status">{message || 'No video is sent to the API; only aggregate counts are published.'}</small>
      <small className="live-camera-privacy">Allow camera access when prompted. Use an approved camera and obtain required consent. Stop the camera when finished.</small>
    </div>
  )
}
