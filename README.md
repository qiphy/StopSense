# Bus-stop telemetry dashboard prototype

A local prototype for testing the data flow before connecting a real ESP32:

```text
Python simulator → FastAPI /telemetry → SQLite → Streamlit dashboard
```

**All readings are synthetic.** This demo does not connect to an ESP32, a real cooling unit, a mobile network, or a cloud service. The API has no authentication and is intended for local demonstration only; do not expose it to the public internet.

## Requirements

- Python 3.10 or later
- Internet access for the initial Python package installation

## Install

From this directory, create and activate a virtual environment, then install requirements:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1`.

## Run the demo

Open three terminals in this directory and activate the same virtual environment in each.

**Terminal 1 — API and local SQLite storage:**

```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Check the API at <http://127.0.0.1:8000/health>. Interactive request documentation is at <http://127.0.0.1:8000/docs>.

**Terminal 2 — simulated bus-stop device:**

```bash
python simulator.py
```

It posts an ESP32-shaped JSON reading every five seconds. Configure it with `DEVICE_ID`, `TELEMETRY_URL`, or `SEND_INTERVAL_SECONDS` environment variables if needed.

**Terminal 3 — dashboard:**

```bash
streamlit run dashboard.py
```

The dashboard refreshes every five seconds and provides three views backed by the same stop telemetry:

- **Passenger app:** stop temperature, humidity, waiting-area crowd level, and next-bus countdowns.
- **Bus-stop screen:** a high-contrast, glanceable display with the next bus, crowd level, temperature, and humidity.
- **Operations dashboard:** cooler state, water and power readings, faults, sensor history, and arrivals.

Bus arrivals are simulated using simple route headways and are prominently labelled as estimates. They are not connected to bus GPS or a transit operator feed. For real arrivals, integrate an authorized operator API or GTFS-Realtime feed and show its source and update time. Stop crowd describes people waiting, **not occupancy onboard a bus**. All simulator values are synthetic.

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

### Experimental doorway in/out counter

`bus_counter.py` is a separate computer-vision experiment. It detects and tracks people locally, then counts each track once when it crosses a virtual line. It does not save or transmit video, and it does not yet send counts to the FastAPI service. Use a doorway camera view where people cross the line in a consistent direction; test and confirm the IN/OUT directions before relying on results. This is an estimate, not certified passenger-counting equipment.

Install its optional packages (YOLO downloads model weights on first run unless you supply a local model):

```bash
python -m pip install opencv-python ultralytics
```

Run from this directory with the default webcam:

```bash
python bus_counter.py --source 0 --axis y --line 0.55 --in-direction down
```

Use `--source path/to/video.mp4` for a recorded test or `--source URL` for a camera stream. For a side-on view, use `--axis x --in-direction right`; switch `right`/`down` to `left`/`up` if your camera orientation is reversed. Adjust `--line` to place the drawn line across the doorway. Press `q` to stop, or pass `--no-display` to run headlessly. Only use camera footage with operator approval, appropriate notices/consent, and a privacy review; do not use facial recognition, and avoid retaining identifiable footage.

By default, the SQLite file is `telemetry.db` in the current directory. Set `TELEMETRY_DB` to change its path. The dashboard can read another API address via `TELEMETRY_API`.

## Moving from simulation to ESP32

Keep the FastAPI payload contract unchanged. First test a real device on a trusted local network and point it at the computer's LAN address, e.g. `http://192.168.1.20:8000/telemetry` (not `localhost`, which would refer to the ESP32 itself). For deployment, add device authentication, HTTPS with certificate validation, access control, retention limits, and robust offline buffering. Keep safety-critical cooling control on the ESP32; the dashboard/server should monitor it, not be required for safe operation.
