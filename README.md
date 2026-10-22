# StopSense bus-stop telemetry prototype

A local prototype with a **React + TypeScript frontend**, FastAPI telemetry API, SQLite storage, and a simulated device:

```text
Python simulator → FastAPI /telemetry → SQLite → React + TypeScript (Vite)
```

All device readings and bus arrivals are synthetic unless you connect an approved real data source. The API has no authentication and is intended for local demonstration only; do not expose it to the public internet.

## Requirements

- Python 3.10 or later
- Node.js 20.19+ or 22.12+ and npm
- Internet access for initial package installation

## Install the backend

From this directory, create and activate a Python virtual environment, then install the backend requirements:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1`.

## Run the complete demo

Open **three terminals**. Keep each process running while you use the frontend.

**Terminal 1 — FastAPI and SQLite backend** (from this directory, with the Python environment activated):

```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Verify at <http://127.0.0.1:8000/health>. API documentation: <http://127.0.0.1:8000/docs>.

**Terminal 2 — simulated bus-stop device** (from this directory, with the same Python environment):

```bash
python simulator.py
```

It posts sensor readings every five seconds. Configure `DEVICE_ID`, `TELEMETRY_URL`, and `SEND_INTERVAL_SECONDS` environment variables if needed.

**Terminal 3 — React + TypeScript frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, usually <http://127.0.0.1:5173>. The Vite development server proxies `/api/*` requests to the FastAPI server at `127.0.0.1:8000`, so no separate CORS configuration is needed for local development. The React page receives telemetry over a live event stream and has three views: passenger app, bus-stop screen, and operations dashboard.

If FastAPI or the simulator is unavailable, the frontend shows clearly labelled preview values; it does not mistake these for real sensor data.

### Frontend production build

From `frontend/`:

```bash
npm run build
npm run preview
```

The development proxy only applies to `npm run dev`. Production builds read `VITE_API_URL` from `frontend/.env.production`, currently set to `https://stopsense.onrender.com`; changing it requires rebuilding and redeploying the static site. The FastAPI app allows browser requests from `https://qiphy.github.io` for its read-only API endpoints. Deploy the updated backend as well as the frontend so the CORS configuration takes effect.

### Solar generation and reference energy use

The dashboard shows illustrative reference load values from the supplied system reference: a 120 W centrifugal fan (assumed 12 h/day), 20 W LED lighting (14 h/day), and 15 W controls + sensors (12 h/day), for a 155 W total rated load and 1.90 kWh/day example consumption. The reference also lists a 0 W gravity-fed pump, 57 kWh/month, 694 kWh/year, RM 315/year at RM 0.454/kWh, and 526 kgCO₂e/year. These are reference assumptions, not site measurements or verified equipment performance.

The reference does **not** provide a separate display wattage: 15 W is labelled “Controls + Sensors” and must not be treated as a confirmed display rating. Solar generation/output is intentionally shown as awaiting panel specifications. Do not infer generation, system sizing, or dimension-based estimates until engineering provides panel specifications and a measurement source.

### Live dashboard updates

The frontend opens a Server-Sent Events connection to `GET /events/telemetry`. The API sends an initial telemetry/passenger-count snapshot and pushes a refreshed snapshot when either ingestion endpoint receives data. EventSource reconnects automatically; bus arrival countdowns continue to update locally each second. The development proxy forwards `/api/events/telemetry` to FastAPI. For a hosted split frontend/backend, set `VITE_API_URL` to the backend base URL and allow the frontend origin in the API CORS configuration.

### Simulated bus arrivals

ETAs are generated in the frontend from example route headways, not live bus GPS. They are labelled simulated in all views. Passenger view includes a time-based sample nearby-shop offer, expandable shop details, sample walk/bus/alight directions, locally generated QR codes for demo voucher and route links, a location-permission prompt, sample disruption alternatives, and a comparison of fictional e-hailing providers. The non-touchscreen stop display shows the shop route, sample voucher, and QR code directly without requiring interaction; a separate QR opens journey alternatives on a phone. QR scans reopen the demo app and display a prototype notice; voucher redemption, map navigation and live service data are not integrated. No user location is stored or sent to the API; location access is only requested after the user presses the button. The demo does not use coordinates for routing: even after permission is granted, the sample alternatives are still based on the selected stop until an approved map/transit routing source is integrated.

The disruption control is a local simulation, not a real disruption feed. Alternative bus routes, fare estimates, pickup ETAs and vehicle types are fictional examples. Selecting “continue” does not place an order or contact a provider. Public transport alternatives are shown first; real multi-provider quotes and booking require transit/map feeds and each e-hailing company’s agreement and API integration. Shop names/offers are also fictional and do not imply a partnership. For real arrivals, connect an authorized transit API or GTFS-Realtime feed and report its source and update time. Crowd level means people waiting at the stop, **not occupancy onboard a bus**.

## Shared ESP32/FastAPI payload

The simulator sends this schema to `POST /telemetry`; a future ESP32 can send the same JSON using HTTP POST with `Content-Type: application/json`:

```json
{
  "device_id": "stop-01",
  "timestamp": "2026-10-19T08:30:00+00:00",
  "temperature_c": 31.2,
  "humidity_pct": 72.0,
  "water_level_pct": 85.0,
  "power_w": 14.6,
  "cooler_on": true,
  "crowd_level": "Moderate",
  "crowd_source": "simulated",
  "fault_code": null
}
```

The API validates values and returns HTTP `201` for accepted data or `422` for invalid fields. `crowd_level` accepts `Low`, `Moderate`, `High`, or `Unknown`; `crowd_source` identifies `simulated`, `manual`, `sensor`, `operator`, or `unknown` data; omitted sources default to `unknown`. Read recent records at `GET /telemetry?limit=200`; filter by device with `GET /telemetry?device_id=stop-01`.

For real deployment, only report a stop crowd level from a verified source (for example manual observation or an approved people-counting sensor), with a timestamp and source label. GPS on buses does not provide occupancy. Onboard bus crowding would need RapidKL passenger-count data or an approved onboard counting system; this demo does not estimate it.

### Doorway passenger counter (boarding/alighting/occupancy)

The Operations view includes a **Start webcam** control. After the operator
clicks it and grants browser permission, the browser captures video and runs a
person detector locally. It estimates boarding/alighting and occupancy from
tracked people crossing the displayed horizontal line. Choose which vertical
direction means entering and set a starting occupancy before starting. The
video frames stay in the browser and are never sent to the API; only aggregate
counts are posted to `POST /passenger-counts`. Camera access requires HTTPS or
`localhost`. The detector model is loaded on first use, so an internet
connection is needed to load it.

The browser counter increments occupancy on an entering crossing and decrements
it on the reverse crossing (clamped at zero). A person disappearing from the
frame is not treated as an exit, since occlusion or a dropped track can cause
false exits. Occupancy is an estimate from observed crossings, not a direct
count of everyone currently onboard. It defaults to zero; set the starting
occupancy before activation if the monitored area is not empty. The browser
tracker is a lightweight prototype and can mis-associate people in dense scenes
or after occlusion; validate it at the actual camera angle before relying on it.

An alternative local Python counter is provided in `bus_counter.py`; it uses
OpenCV and Ultralytics, and has its own `--initial-occupancy` argument. Its
frames also stay on the host and are never uploaded. Do not run both counters
against the same webcam at once, as the camera may not support simultaneous
access. These camera counts are separate from `crowd_level`, which means people
waiting at the bus stop. The React Operations view shows each camera's boarding,
alighting, estimated occupancy, status, confidence, and update time. The live
camera preview appears in this view only while the operator has started it.

The Operations camera controls let the operator associate the current crossing
counter with a sample bus route and cycle among routes. Passenger view shows
only the selected bus's crowd level (Low, Moderate, or High), without camera
controls, video, or a raw occupancy count. Bus crowd levels are derived from the
counter's starting occupancy plus tracked doorway crossings; they are not a
direct view of all passengers inside the bus. The demonstration thresholds are
Low (0–10), Moderate (11–25), and High (26+), and are not validated capacity
limits. These route estimates are separate from stop waiting-area crowd
telemetry.

Where the browser exposes multiple video inputs, the camera selector can choose
one directly and the front/back control requests the user-facing or
environment-facing camera. Camera availability depends on device, browser, and
permissions; a one-camera device cannot switch between physical cameras.

The API accepts this aggregate payload at `POST /passenger-counts` and keeps the
latest report per camera in a dedicated SQLite table; it does not alter the
existing `/telemetry` schema. `occupancy_count` is nullable for older counter
clients. Retrieve reports with `GET /passenger-counts` or filter with
`GET /passenger-counts?camera_id=bus-door-01`:

```json
{
  "camera_id": "bus-door-01",
  "observed_at": "2026-10-21T00:00:00+00:00",
  "boarding_count": 3,
  "alighting_count": 1,
  "occupancy_count": 12,
  "confidence": 0.82,
  "status": "ok"
}
```

Install optional camera dependencies (the default YOLO model weights download
on first run; pass a local model path to avoid that):

```bash
python -m pip install opencv-python ultralytics
```

Run after starting FastAPI, using the default webcam:

```bash
python bus_counter.py --source 0 --camera-id bus-door-01 --axis y --line 0.55 --in-direction down
```

Use `--source path/to/video.mp4` for a recorded test or `--source URL` for a
camera stream. For a side-on view, use `--axis x --in-direction right`; switch
`right`/`down` to `left`/`up` if your camera orientation is reversed. Adjust
`--line` to position the virtual line. Configure the detector with `--model`
and `--confidence`, and tracking with `--tracker`; set `--hysteresis` to add a
dead-band against line jitter. Use `--initial-occupancy N` to seed a non-empty
monitored area at startup (the default is zero). `--api-url ""` disables
publishing, and `--no-display` runs headlessly. `PASSENGER_COUNT_API_URL`,
`PASSENGER_CAMERA_ID`, and `PASSENGER_MODEL` can also configure these values.
The API replaces each camera's latest aggregate, while the camera's boarding,
alighting, and occupancy values are cumulative/estimated for that counter
process. Status changes to offline at stream end and the UI marks an otherwise-ok
report stale after 30 seconds. Confidence is the mean model score for counted
crossings, not calibrated counting accuracy.

Validate the line counter without a camera or optional CV packages:

```bash
python bus_counter.py --self-test
python -m unittest test_passenger_counts.py
```

This is a prototype, not certified passenger-counting equipment. Validate and
tune the model, line, direction, and tracking on the actual camera angle;
occlusion, dense crowds, and track swaps can cause errors. Only use camera
footage with operator approval, appropriate notices/consent, and a privacy
review; do not use facial recognition or retain identifiable footage.

By default, the SQLite file is `telemetry.db` in the current directory. Set `TELEMETRY_DB` to change its path.

## Moving from simulation to ESP32

Keep the FastAPI payload contract unchanged. First test a real device on a trusted local network and point it at the computer's LAN address, e.g. `http://192.168.1.20:8000/telemetry` (not `localhost`, which would refer to the ESP32 itself). For deployment, add device authentication, HTTPS with certificate validation, access control, retention limits, and robust offline buffering. Keep safety-critical cooling control on the ESP32; the dashboard/server should monitor it, not be required for safe operation.
