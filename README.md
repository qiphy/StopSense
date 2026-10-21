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

Open the local URL printed by Vite, usually <http://127.0.0.1:5173>. The Vite development server proxies `/api/*` requests to the FastAPI server at `127.0.0.1:8000`, so no separate CORS configuration is needed for local development. The React page refreshes telemetry every five seconds and has three views: passenger app, bus-stop screen, and operations dashboard.

If FastAPI or the simulator is unavailable, the frontend shows clearly labelled preview values; it does not mistake these for real sensor data.

### Frontend production build

From `frontend/`:

```bash
npm run build
npm run preview
```

The development proxy only applies to `npm run dev`. Production builds read `VITE_API_URL` from `frontend/.env.production`, currently set to `https://StopSense.onrender.com`; changing it requires rebuilding and redeploying the static site. The FastAPI app allows browser requests from `https://qiphy.github.io` for its read-only API endpoints. Deploy the updated backend as well as the frontend so the CORS configuration takes effect.

### Solar generation preview

The dashboard includes a solar-energy display with fixed example values (2.4 kWh generated today and 185 W current output). These are **sample placeholders only**: they are not measurements, forecasts, or estimates based on panel dimensions. Engineering specifications are pending; replace the placeholders with verified telemetry once the panel design and measurement source are available.

### Simulated bus arrivals

ETAs are generated in the frontend from example route headways, not live bus GPS. They are labelled simulated in all views. For real arrivals, connect an authorized transit API or GTFS-Realtime feed and report its source and update time. Crowd level means people waiting at the stop, **not occupancy onboard a bus**.

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

### Doorway passenger counter (boarding/alighting)

`bus_counter.py` detects and tracks people on the local machine and counts a
track once when it crosses the configured doorway line. Frames stay in process
memory: the script does not save or transmit footage, and it uses no facial
recognition. These counts are a separate metric from `crowd_level`, which still
means people waiting at the bus stop. The React UI shows each camera's boarding
and alighting totals, status, confidence, and update time in all three views.

The API accepts this aggregate payload at `POST /passenger-counts` and keeps the
latest report per camera in a dedicated SQLite table; it does not alter the
existing `/telemetry` schema. Retrieve reports with `GET /passenger-counts` or
filter with `GET /passenger-counts?camera_id=bus-door-01`:

```json
{
  "camera_id": "bus-door-01",
  "observed_at": "2026-10-21T00:00:00+00:00",
  "boarding_count": 3,
  "alighting_count": 1,
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
dead-band against line jitter. `--api-url ""` disables publishing, and
`--no-display` runs headlessly. `PASSENGER_COUNT_API_URL`, `PASSENGER_CAMERA_ID`,
and `PASSENGER_MODEL` can also configure these values. The API replaces each
camera's latest aggregate, while the camera's totals are cumulative for that
counter process. Status changes to offline at stream end and the UI marks an
otherwise-ok report stale after 30 seconds. Confidence is the mean model score
for counted crossings, not calibrated counting accuracy.

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
