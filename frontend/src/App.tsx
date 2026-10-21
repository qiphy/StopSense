import { useCallback, useEffect, useMemo, useState } from 'react'

type CrowdLevel = 'Low' | 'Moderate' | 'High' | 'Unknown'
type Reading = {
  id: number
  device_id: string
  timestamp: string
  temperature_c: number
  humidity_pct: number
  water_level_pct: number
  power_w: number
  cooler_on: boolean
  crowd_level: CrowdLevel
  crowd_source: string
  fault_code: string | null
}
type PassengerCount = {
  camera_id: string
  observed_at: string
  boarding_count: number
  alighting_count: number
  confidence: number
  status: 'ok' | 'degraded' | 'offline' | 'error'
}
type View = 'passenger' | 'screen' | 'operations'
type Route = { route: string; destination: string; headway: number; offset: number }

const API = import.meta.env.VITE_API_URL || '/api'
const routes: Route[] = [
  { route: 'T1', destination: 'Town Centre', headway: 8, offset: 17 },
  { route: 'T2', destination: 'MRT Station', headway: 12, offset: 103 },
  { route: 'T3', destination: 'Community Mall', headway: 15, offset: 241 },
]

const previewReadings: Reading[] = [
  { id: 1, device_id: 'demo-stop-01', timestamp: new Date().toISOString(), temperature_c: 31.2, humidity_pct: 72, water_level_pct: 82, power_w: 13.8, cooler_on: true, crowd_level: 'Moderate', crowd_source: 'simulated', fault_code: null },
  { id: 2, device_id: 'demo-stop-02', timestamp: new Date().toISOString(), temperature_c: 33.4, humidity_pct: 78, water_level_pct: 61, power_w: 15.1, cooler_on: true, crowd_level: 'High', crowd_source: 'simulated', fault_code: null },
  { id: 3, device_id: 'demo-stop-03', timestamp: new Date().toISOString(), temperature_c: 30.1, humidity_pct: 69, water_level_pct: 94, power_w: 0.4, cooler_on: false, crowd_level: 'Low', crowd_source: 'simulated', fault_code: 'STANDBY' },
]

function getArrivals(stopId: string, now: number) {
  const stopOffset = [...stopId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 180
  return routes.flatMap((route) => {
    const headway = route.headway * 60
    const phase = (Math.floor(now / 1000) + route.offset + stopOffset) % headway
    const first = Math.max(1, headway - phase)
    return [0, 1].map((index) => ({
      route: route.route,
      destination: route.destination,
      eta: first + index * headway,
    }))
  }).sort((a, b) => a.eta - b.eta)
}

function formatEta(seconds: number) {
  if (seconds <= 10) return 'Due'
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining < 10 ? `${minutes} min` : `${minutes} min ${remaining} sec`
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function latestPerStop(readings: Reading[]) {
  const latest = new Map<string, Reading>()
  for (const reading of readings) {
    const previous = latest.get(reading.device_id)
    if (!previous || new Date(reading.timestamp).getTime() > new Date(previous.timestamp).getTime() || (reading.timestamp === previous.timestamp && reading.id > previous.id)) {
      latest.set(reading.device_id, reading)
    }
  }
  return [...latest.values()].sort((a, b) => a.device_id.localeCompare(b.device_id))
}

function App() {
  const [readings, setReadings] = useState<Reading[]>([])
  const [passengerCounts, setPassengerCounts] = useState<PassengerCount[]>([])
  const [selectedStop, setSelectedStop] = useState('')
  const [view, setView] = useState<View>('passenger')
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [usingPreview, setUsingPreview] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${API}/telemetry?limit=500`)
      if (!response.ok) throw new Error(`API returned ${response.status}`)
      const body = (await response.json()) as { items?: Reading[] }
      if (!Array.isArray(body.items)) throw new Error('Unexpected telemetry response')
      setReadings(body.items)
      try {
        const countResponse = await fetch(`${API}/passenger-counts`)
        const countBody = countResponse.ok ? (await countResponse.json()) as { items?: PassengerCount[] } : null
        setPassengerCounts(Array.isArray(countBody?.items) ? countBody.items : [])
      } catch {
        setPassengerCounts([])
      }
      setError('')
      setUsingPreview(body.items.length === 0)
      if (body.items.length === 0) setReadings(previewReadings)
    } catch (cause) {
      setReadings(previewReadings)
      setPassengerCounts([])
      setUsingPreview(true)
      setError(cause instanceof Error ? cause.message : 'Could not connect to the telemetry API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const poll = window.setInterval(() => void refresh(), 5000)
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(clock)
    }
  }, [refresh])

  const latest = useMemo(() => latestPerStop(readings), [readings])
  useEffect(() => {
    if (latest.length > 0 && !latest.some((reading) => reading.device_id === selectedStop)) {
      setSelectedStop(latest[0].device_id)
    }
  }, [latest, selectedStop])

  const reading = latest.find((item) => item.device_id === selectedStop) ?? latest[0]
  const arrivals = reading ? getArrivals(reading.device_id, now) : []

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="StopSense home">
          <span className="brand-mark">C</span>
          <span>StopSense<span className="brand-dot">.</span><small>Township transit, made better</small></span>
        </a>
        <div className="topbar-right">
          <span className={`connection ${error ? 'connection-offline' : ''}`}><i />{error ? 'Preview mode' : 'Demo system'}</span>
          <button className="avatar" aria-label="Demo profile">DS</button>
        </div>
      </header>

      <main className="main-content" id="home">
        <div className="page-heading">
          <div>
            <div className="eyebrow">TOWNSHIP MOBILITY · PROTOTYPE</div>
            <h1>A cooler, clearer<br className="mobile-break" /> way to wait.</h1>
            <p>Comfort conditions, bus arrivals and stop operations, all in one place.</p>
          </div>
          <div className="updated-pill"><span className="pulse-dot" /> Updates every 5 seconds</div>
        </div>

        <div className={`demo-notice ${usingPreview ? 'preview-notice' : ''}`}>
          <span className="notice-icon">{usingPreview ? '◷' : 'i'}</span>
          <span><strong>{usingPreview ? 'PREVIEW DATA' : 'DEMO MODE'}</strong> — stop readings are {usingPreview ? 'example values shown because the API has no data' : 'simulated by the software device simulator'}. Bus arrival times are generated from a sample timetable, not live GPS.{error && <small className="notice-error">API connection: {error}. Start FastAPI and simulator.py to load readings.</small>}</span>
        </div>

        <nav className="view-switcher" aria-label="Choose dashboard view">
          <button className={view === 'passenger' ? 'active' : ''} onClick={() => setView('passenger')}><span>⌕</span> Passenger app</button>
          <button className={view === 'screen' ? 'active' : ''} onClick={() => setView('screen')}><span>▣</span> Bus-stop screen</button>
          <button className={view === 'operations' ? 'active' : ''} onClick={() => setView('operations')}><span>⌘</span> Operations</button>
        </nav>

        {loading && latest.length === 0 ? <div className="loading-card">Connecting to the stop telemetry service…</div> : !reading ? <div className="loading-card">No stop data is available.</div> : (
          <>
            <div className="stop-toolbar">
              <div className="stop-label"><span className="pin">⌖</span><span><strong>YOUR BUS STOP</strong><small>Select a stop to view live conditions</small></span></div>
              <label className="select-wrap"><span className="sr-only">Select bus stop</span><select value={reading.device_id} onChange={(event) => setSelectedStop(event.target.value)}>{latest.map((item) => <option key={item.device_id} value={item.device_id}>{item.device_id}</option>)}</select><span className="select-chevron">⌄</span></label>
            </div>

            {view === 'passenger' && <PassengerView reading={reading} arrivals={arrivals} />}
            {view === 'screen' && <StopScreen reading={reading} arrivals={arrivals} />}
            {view === 'operations' && <OperationsView readings={latest} reading={reading} arrivals={arrivals} />}
            <SolarGeneration />
            {view === 'operations' && <PassengerFlow reports={passengerCounts} />}
          </>
        )}

        <footer className="footer"><span>StopSense · Bus stop cooling and transit information prototype</span><span>Crowd level is waiting-area estimate, not onboard occupancy.</span></footer>
      </main>
    </div>
  )
}

function PassengerView({ reading, arrivals }: { reading: Reading; arrivals: ReturnType<typeof getArrivals> }) {
  const nextBus = arrivals[0]
  return (
    <section className="passenger-grid">
      <article className="arrival-card">
        <div className="card-topline"><span className="card-kicker">NEXT BUS ARRIVAL</span><span className="simulated-tag">SIMULATED</span></div>
        <div className="arrival-main"><div><span className="route-chip">{nextBus.route}</span><span className="destination">{nextBus.destination}</span></div><strong>{formatEta(nextBus.eta)}</strong></div>
        <div className="arrival-progress"><span style={{ width: `${Math.max(8, 100 - nextBus.eta / 900 * 100)}%` }} /></div>
        <div className="arrival-foot"><span>Sample scheduled service</span><span>Times may vary</span></div>
        <div className="upcoming-list">{arrivals.slice(1, 3).map((bus) => <div className="upcoming-row" key={`${bus.route}-${bus.eta}`}><span><b>{bus.route}</b> · {bus.destination}</span><strong>{formatEta(bus.eta)}</strong></div>)}</div>
      </article>

      <article className="comfort-card">
        <div className="section-heading"><div><span className="card-kicker">AT YOUR STOP</span><h2>Waiting conditions</h2></div><span className="live-tag"><i /> {reading.crowd_source}</span></div>
        <div className="condition-grid">
          <Condition icon="☀" label="Air temperature" value={`${reading.temperature_c.toFixed(1)}°`} unit="C" tone="warm" detail="At the bus shelter" />
          <Condition icon="≈" label="Humidity" value={`${Math.round(reading.humidity_pct)}`} unit="%" tone="blue" detail="Relative humidity" />
          <Condition icon="♙" label="Waiting crowd" value={reading.crowd_level} unit="" tone="green" detail="People at this stop" />
        </div>
        <div className="comfort-tip"><span>✦</span><span><strong>Cooling system {reading.cooler_on ? 'is running' : 'is on standby'}</strong><small>Comfort data last updated {formatTimestamp(reading.timestamp)}</small></span></div>
      </article>
    </section>
  )
}

function Condition({ icon, label, value, unit, tone, detail }: { icon: string; label: string; value: string; unit: string; tone: string; detail: string }) {
  return <div className="condition-item"><span className={`condition-icon ${tone}`}>{icon}</span><span className="condition-label">{label}</span><strong className="condition-value">{value}<small>{unit}</small></strong><span className="condition-detail">{detail}</span></div>
}

function PassengerFlow({ reports }: { reports: PassengerCount[] }) {
  return (
    <section className="passenger-flow-panel" aria-labelledby="passenger-flow-title">
      <div className="passenger-flow-heading">
        <div><span className="card-kicker">ONBOARD PASSENGER FLOW</span><h2 id="passenger-flow-title">Doorway camera counts</h2></div>
        <span className="flow-separation-note">Separate from people waiting at the stop</span>
      </div>
      {reports.length === 0 ? (
        <div className="flow-empty">No doorway camera reports yet. Counts will appear when the local camera counter is running.</div>
      ) : (
        <div className="flow-camera-list">
          {reports.map((report) => {
            const observed = new Date(report.observed_at).getTime()
            const stale = !Number.isFinite(observed) || Date.now() - observed > 30000
            const status = stale && report.status === 'ok' ? 'stale' : report.status
            const confidence = Math.max(0, Math.min(1, report.confidence))
            return (
              <article className="flow-camera" key={report.camera_id}>
                <div className="flow-camera-title"><strong>{report.camera_id}</strong><span className={`flow-status flow-status-${status}`}>{status}</span></div>
                <div className="flow-counts">
                  <div><span>Boarding</span><strong>{report.boarding_count}</strong></div>
                  <div><span>Alighting</span><strong>{report.alighting_count}</strong></div>
                </div>
                <div className="flow-confidence"><span>Detector confidence <strong>{Math.round(confidence * 100)}%</strong></span><div><i style={{ width: `${confidence * 100}%` }} /></div></div>
                <small className="flow-updated">Updated {formatTimestamp(report.observed_at)}</small>
              </article>
            )
          })}
        </div>
      )}
      <p className="flow-disclaimer">Counts are camera estimates for people crossing the bus doorway, not a count of the stop crowd. Confidence is a detector score, not a calibrated accuracy guarantee.</p>
    </section>
  )
}

function StopScreen({ reading, arrivals }: { reading: Reading; arrivals: ReturnType<typeof getArrivals> }) {
  return (
    <section className="screen-wrap">
      <div className="screen-device">
        <div className="screen-header"><span className="screen-logo">C</span><span>StopSense <small>SMART BUS STOP</small></span><span className="screen-clock">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="screen-next-label">UPCOMING BUSES <span className="simulated-tag">SIMULATED</span></div>
        <div className="screen-arrivals" aria-label="Upcoming bus arrivals">
          {arrivals.slice(0, 6).map((bus, index) => (
            <article className="screen-arrival-card" key={`${bus.route}-${index}`}>
              <div className="screen-arrival-card-top"><span className="screen-route small">{bus.route}</span><strong>{formatEta(bus.eta)}</strong></div>
              <span className="screen-arrival-destination">{bus.destination}</span>
            </article>
          ))}
        </div>
        <div className="screen-info"><span><i className="screen-sun">☀</i> {reading.temperature_c.toFixed(1)}°C <small>Temperature</small></span><span><i className="screen-humidity">≈</i> {Math.round(reading.humidity_pct)}% <small>Humidity</small></span><span><i className="screen-crowd">♙</i> {reading.crowd_level} <small>Waiting crowd</small></span></div>
        <div className="screen-footer">Arrival estimates for demonstration · Not connected to live bus GPS</div>
      </div>
      <div className="screen-notes"><span className="screen-note-icon">▣</span><div><strong>Designed for a quick glance</strong><p>Upcoming services are shown together for easy comparison. This view is a screen mock-up; arrival estimates are simulated.</p></div></div>
    </section>
  )
}

function OperationsView({ readings, reading, arrivals }: { readings: Reading[]; reading: Reading; arrivals: ReturnType<typeof getArrivals> }) {
  const fault = reading.fault_code
  const state = fault ? 'Needs attention' : reading.cooler_on ? 'Cooling active' : 'Standby'
  return (
    <section className="operations-view">
      <div className="operations-heading"><div><span className="card-kicker">FLEET MONITOR</span><h2>Stop operations</h2></div><span className={`state-badge ${fault ? 'fault' : ''}`}><i />{state}</span></div>
      <div className="ops-grid">
        <OpsMetric label="Air temperature" value={`${reading.temperature_c.toFixed(1)} °C`} icon="☀" note="Shelter sensor" />
        <OpsMetric label="Relative humidity" value={`${reading.humidity_pct.toFixed(1)}%`} icon="≈" note="Shelter sensor" />
        <OpsMetric label="Water remaining" value={`${reading.water_level_pct.toFixed(0)}%`} icon="♧" note={reading.water_level_pct < 20 ? 'Refill required' : 'Tank level'} alert={reading.water_level_pct < 20} />
        <OpsMetric label="Power draw" value={`${reading.power_w.toFixed(1)} W`} icon="ϟ" note="Cooling equipment" />
      </div>
      {fault && <div className="fault-banner"><strong>Fault reported: {fault}</strong><span>Inspect the device and confirm water and sensor status.</span></div>}
      <div className="ops-lower-grid">
        <article className="ops-panel"><div className="panel-heading"><div><span className="card-kicker">SERVICE ESTIMATE</span><h3>Upcoming arrivals</h3></div><span className="simulated-tag">SIMULATED</span></div>{arrivals.slice(0, 3).map((bus) => <div className="service-row" key={`${bus.route}-${bus.eta}`}><span className="route-chip small">{bus.route}</span><span className="service-destination">{bus.destination}</span><strong>{formatEta(bus.eta)}</strong></div>)}<p className="panel-footnote">Headway-based demo values. Connect an authorized transit feed for live ETAs.</p></article>
        <article className="ops-panel"><div className="panel-heading"><div><span className="card-kicker">DEVICE HEALTH</span><h3>{reading.device_id}</h3></div><span className="device-dot"><i /> Online</span></div><div className="health-row"><span>Waiting-area crowd</span><strong>{reading.crowd_level}</strong></div><div className="health-row"><span>Crowd data source</span><strong>{reading.crowd_source}</strong></div><div className="health-row"><span>Last sensor update</span><strong>{formatTimestamp(reading.timestamp)}</strong></div><div className="health-row"><span>Cooler state</span><strong>{reading.cooler_on ? 'On' : 'Off'}</strong></div></article>
      </div>
      <div className="site-summary"><div><strong>{readings.length}</strong><span>stops reporting</span></div><div><strong>{readings.filter((item) => item.cooler_on).length}</strong><span>coolers running</span></div><div><strong>{readings.filter((item) => Boolean(item.fault_code)).length}</strong><span>faults reported</span></div><small>Telemetry refreshes every 5 seconds · Demonstration values only</small></div>
    </section>
  )
}

function OpsMetric({ label, value, icon, note, alert = false }: { label: string; value: string; icon: string; note: string; alert?: boolean }) {
  return <article className={`ops-metric ${alert ? 'metric-alert' : ''}`}><span className="ops-icon">{icon}</span><span className="ops-label">{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function SolarGeneration() {
  return (
    <section className="solar-panel" aria-labelledby="solar-title">
      <div className="solar-heading">
        <div><span className="card-kicker">SOLAR ENERGY</span><h2 id="solar-title">Panel generation</h2></div>
        <span className="simulated-tag">SAMPLE DATA</span>
      </div>
      <div className="solar-metrics">
        <div><span>Generated today</span><strong>2.4 <small>kWh</small></strong></div>
        <div><span>Current output</span><strong>185 <small>W</small></strong></div>
      </div>
      <p>Illustrative placeholders only—not measured data or estimates based on panel dimensions. Engineering specifications are pending.</p>
    </section>
  )
}

export default App
