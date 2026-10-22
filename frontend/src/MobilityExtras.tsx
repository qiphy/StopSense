import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

type ShopOffer = {
  id: string
  slot: 'peak' | 'lunch' | 'school' | 'all-day'
  shop: string
  title: string
  detail: string
  voucher: string
  walk: string
  route: string
  alight: string
}

const offers: ShopOffer[] = [
  { id: 'morning', slot: 'peak', shop: 'Corner Cup Café · sample partner', title: 'Morning commuter set', detail: 'Coffee + toast · morning/evening commuter sample offer', voucher: 'COMMUTE10', walk: '4 min walk · 280 m', route: 'T1 · Town Centre', alight: 'Market Street stop' },
  { id: 'lunch', slot: 'lunch', shop: 'Green Bowl Kitchen · sample partner', title: 'Lunch break bowl', detail: 'Save RM 3 on a sample lunch set, 11:00–14:00', voucher: 'LUNCH3', walk: '6 min walk · 420 m', route: 'T2 · MRT Station', alight: 'Central Market stop' },
  { id: 'school', slot: 'school', shop: 'Little Maple Bookshop · sample partner', title: 'After-school treat', detail: 'Sample student snack + stationery bundle, 14:00–17:00', voucher: 'SCHOOL5', walk: '5 min walk · 350 m', route: 'T3 · Community Mall', alight: 'Community Mall stop' },
  { id: 'evening', slot: 'all-day', shop: 'Neighbourhood Market · sample partner', title: 'A useful stop on your way home', detail: 'Sample essentials offer · check opening hours', voucher: 'WAYHOME', walk: '7 min walk · 500 m', route: 'T1 · Town Centre', alight: 'Market Street stop' },
]

export function getOfferLinkDetails(id: string) {
  const offer = offers.find((item) => item.id === id)
  return offer ? { shop: offer.shop, walk: offer.walk, route: offer.route, alight: offer.alight } : null
}

function slotForHour(hour: number): ShopOffer['slot'] {
  if ((hour >= 6 && hour < 10) || (hour >= 17 && hour < 20)) return 'peak'
  if (hour >= 11 && hour < 14) return 'lunch'
  if (hour >= 14 && hour < 17) return 'school'
  return 'all-day'
}

function offerForNow(now: Date) {
  const slot = slotForHour(now.getHours())
  return offers.find((offer) => offer.slot === slot) ?? offers[offers.length - 1]
}

function appLink(kind: 'voucher' | 'route' | 'alternatives', value: string) {
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${kind}=${encodeURIComponent(value)}`
}

function useRotatingOffer() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  return offerForNow(now)
}

export function LocalQr({ value, label }: { value: string; label: string }) {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    let active = true
    void QRCode.toDataURL(value, { width: 144, margin: 1, color: { dark: '#173b2b', light: '#ffffff' } })
      .then((url) => { if (active) setDataUrl(url) })
      .catch(() => { if (active) setDataUrl('') })
    return () => { active = false }
  }, [value])
  return <div className="local-qr" aria-label={`${label} QR code`}>{dataUrl ? <img src={dataUrl} alt={`${label} QR code`} /> : <span>Preparing QR…</span>}<small>{label}</small></div>
}

export function ShopOfferCard({ stopId, compact = false }: { stopId: string; compact?: boolean }) {
  const offer = useRotatingOffer()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const voucherUrl = appLink('voucher', offer.voucher)
  const routeUrl = appLink('route', `${stopId}|${offer.id}`)
  return (
    <section className={`shop-offer-card ${compact ? 'shop-offer-compact' : ''}`} aria-label="Sample nearby shop offer">
      <div className="shop-offer-main">
        <div><span className="card-kicker">NEARBY · TIME-BASED SAMPLE OFFER</span><span className="simulated-tag">SAMPLE PARTNER</span></div>
        <strong>{offer.title}</strong>
        <span>{offer.shop} · {offer.detail}</span>
        <button type="button" className="shop-offer-link" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>{detailsOpen ? 'Hide shop details' : 'Shop details, directions & voucher'} <b>{detailsOpen ? '−' : '↗'}</b></button>
      </div>
      {detailsOpen && <div className="shop-offer-details">
        <div className="shop-directions"><strong>From {stopId}</strong><span>🚶 {offer.walk}</span><span>🚌 {offer.route}</span><span>↓ Alight: {offer.alight}</span><small>Sample directions only · verify with a live map before travelling.</small></div>
        <div className="shop-voucher"><strong>Sample voucher: {offer.voucher}</strong><span>Scan to open the demo voucher link. Real redemption needs the shop and app integration.</span><LocalQr value={voucherUrl} label="Demo voucher" /></div>
        <div className="shop-route-qr"><strong>Continue journey</strong><span>Scan to open the sample route link.</span><LocalQr value={routeUrl} label="Demo directions" /></div>
      </div>}
      <small className="prototype-note">Rotates by local time: commuter peak, lunch, after school, or all-day. No real shop partnership or offer is implied.</small>
    </section>
  )
}

export function EhailingCompare({ disrupted = false, stopId }: { disrupted?: boolean; stopId: string }) {
  const [selected, setSelected] = useState('swift')
  const [confirmed, setConfirmed] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')
  const [showAlternatives, setShowAlternatives] = useState(disrupted)
  const [isDisrupted, setIsDisrupted] = useState(disrupted)
  const [destination, setDestination] = useState('MRT Station')
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Location is unavailable in this browser. You can still view sample alternatives from this stop.')
      setShowAlternatives(true)
      return
    }
    setLocationStatus('Requesting location permission…')
    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationStatus('Location permission granted for this session; coordinates are not stored or sent. Because no map/routing feed is connected, the options below remain sample estimates from the selected stop.')
        setShowAlternatives(true)
      },
      () => { setLocationStatus('Location was not shared. You can still view sample alternatives from this stop.'); setShowAlternatives(true) }, 
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }
  const partnerOptions = [
    { id: 'swift', name: 'SwiftRide · sample', fare: 'RM 8–12', pickup: '5–8 min', car: 'Standard · 4 seats' },
    { id: 'city', name: 'CityCab · sample', fare: 'RM 10–15', pickup: '7–10 min', car: 'Taxi · 4 seats' },
    { id: 'green', name: 'GoGreen · sample', fare: 'RM 13–18', pickup: '8–12 min', car: 'Electric · 4 seats' },
  ]
  return (
    <section className="journey-options" aria-label="Journey alternatives">
      <div className="journey-options-heading"><div><span className="card-kicker">WHEN PUBLIC TRANSPORT IS DISRUPTED</span><h2>Compare a ride alternative</h2></div><span className="simulated-tag">SAMPLE ONLY</span></div>
      <div className="journey-demo-controls"><button type="button" className="text-action" onClick={() => { setIsDisrupted((active) => !active); setShowAlternatives(true); setConfirmed(false) }}>{isDisrupted ? 'Clear sample disruption' : 'Simulate a service disruption'}</button>{isDisrupted && <span>Sample disruption mode</span>}</div>
      {isDisrupted && <div className="disruption-banner"><strong>Sample service disruption at {stopId}</strong><span>Public transport remains the first choice when operating; compare alternatives if needed.</span></div>}
      {!showAlternatives ? <div className="journey-location-prompt"><span>Check example options from your location, only if you choose to share it.</span><button type="button" onClick={requestLocation}>Use my location</button><button type="button" className="text-action" onClick={() => setShowAlternatives(true)}>View sample from this stop</button></div> : <>
        <label className="destination-select">Destination <select value={destination} onChange={(event) => { setDestination(event.target.value); setConfirmed(false) }}><option>MRT Station</option><option>Town Centre</option><option>Community Mall</option></select></label>
        <div className="sample-transit-alternatives"><strong>Public-transport alternatives first</strong><span>Sample: walk 4 min to Central Stop → T2 to MRT Station · about 18 min</span><span>Sample: walk 6 min to Community Stop → T3 to Community Mall · about 22 min</span><small>Illustrative routes and times only; no live disruption or route feed is connected.</small></div>
        <div className="ride-partner-grid">{partnerOptions.map((option) => <button type="button" key={option.id} className={`ride-partner ${selected === option.id ? 'selected' : ''}`} onClick={() => { setSelected(option.id); setConfirmed(false) }} aria-pressed={selected === option.id}><strong>{option.name}</strong><span>{option.fare}</span><small>{option.pickup} pickup · {option.car}</small></button>)}</div>
        <button type="button" className="ride-confirm" onClick={() => setConfirmed(true)}>Compare / continue with selected sample</button>
        {confirmed && <div className="ride-confirmation" role="status">Demo choice: {partnerOptions.find((option) => option.id === selected)?.name} to {destination}. No ride was booked. Live prices, vehicle availability and booking require each provider’s agreement and integration.</div>}
      </>}
      {locationStatus && <small className="location-status" role="status">{locationStatus}</small>}
      <small className="prototype-note">Sample providers, fares, pickup times and vehicle types are fictional estimates, not live quotes. No booking is made; commercial integrations require partner agreements.</small>
    </section>
  )
}

export function ScreenSampleAd({ stopId }: { stopId: string }) {
  const offer = useRotatingOffer()
  const [activeSlide, setActiveSlide] = useState(0)
  const slides = [
    { label: 'TIME-BASED SHOP OFFER · SAMPLE', title: offer.title, shop: offer.shop, detail: offer.detail, visual: '☕', qrLabel: 'Shop route', qrValue: appLink('route', `${stopId}|${offer.id}`), directions: [`🚶 ${offer.walk}`, `🚌 ${offer.route}`, `↓ Alight at ${offer.alight}`] },
    { label: 'MORE TO EXPLORE · SAMPLE PROMO', title: 'A little extra for your journey', shop: 'Neighbourhood Market · sample partner', detail: 'Scan for a sample promo and shop details.', visual: '✦', qrLabel: 'Scan for promo', qrValue: appLink('voucher', 'WAYHOME'), directions: ['Sample promo: WAYHOME', 'Nearby stop essentials', 'Voucher redemption is not connected.'] },
  ]
  useEffect(() => {
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % slides.length), 15000)
    return () => window.clearInterval(timer)
  }, [slides.length])
  return (
    <section className="screen-ad-carousel" aria-label="Rotating sample advertisements" aria-roledescription="carousel">
      <div className="screen-ad-viewport">
        <div className="screen-ad-track" style={{ transform: `translateX(-${activeSlide * 100}%)` }}>
          {slides.map((slide, index) => (
            <article className="screen-ad-slide" key={slide.label} aria-label={`Advertisement ${index + 1} of ${slides.length}`}>
              <div className="screen-ad-art" aria-hidden="true"><span>{slide.visual}</span><small>StopSense<br />LOCAL PICKS</small></div>
              <div className="screen-ad-copy"><span className="screen-ad-label">{slide.label}</span><strong>{slide.title}</strong><span>{slide.shop}</span><small>{slide.detail}</small></div>
              <div className="screen-ad-route"><strong>{index === 0 ? 'ROUTE & OFFER' : 'SCAN FOR MORE'}</strong>{slide.directions.map((line) => <span key={line}>{line}</span>)}<small>Sample information only.</small></div>
              <LocalQr value={slide.qrValue} label={slide.qrLabel} />
            </article>
          ))}
        </div>
      </div>
      <div className="screen-ad-pagination" aria-hidden="true"><span>{activeSlide + 1} / {slides.length}</span><div>{slides.map((slide, index) => <i key={slide.label} className={activeSlide === index ? 'active' : ''} />)}</div><span>Changes every 15 sec</span></div>
      <small className="screen-ad-disclaimer">Fictional sample ads, routes, and promotions. No partner or voucher redemption is connected.</small>
    </section>
  )
}

export function StopAlternativesQr({ stopId }: { stopId: string }) {
  const value = appLink('alternatives', stopId)
  return <div className="stop-alternatives-qr"><div><strong>Disrupted? Continue on your phone</strong><span>Scan for sample public-transport alternatives and ride options from this stop.</span></div><LocalQr value={value} label="Demo alternatives" /></div>
}
