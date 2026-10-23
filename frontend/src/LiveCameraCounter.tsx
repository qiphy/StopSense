type Bus = { route: string; destination: string }

export default function LiveCameraCounter({ buses, selectedBusRoute, onBusChange }: {
  buses: Bus[]
  selectedBusRoute: string
  onBusChange: (route: string) => void
}) {
  return (
    <div className="live-camera" aria-labelledby="counter-setup-title">
      <div className="live-camera-heading">
        <div>
          <strong id="counter-setup-title">Local Python doorway counter</strong>
          <span>YOLO person detection + ByteTrack tracking run on the camera host.</span>
        </div>
        <label>Bus route
          <select aria-label="Bus route for the local doorway counter" value={selectedBusRoute} onChange={(event) => onBusChange(event.target.value)}>
            {buses.map((bus) => <option key={bus.route} value={bus.route}>{bus.route} · {bus.destination}</option>)}
          </select>
        </label>
      </div>
      <ol className="counter-setup-steps">
        <li>On the computer attached to the bus-door camera, install the optional counter dependencies: <code>python -m pip install -r requirements-camera.txt</code>.</li>
        <li>Start the API with <code>uvicorn main:app --reload</code>, then start the camera counter:</li>
      </ol>
      <pre className="counter-command"><code>{`python bus_counter.py --source 0 --camera-id bus-door-01 --bus-route ${selectedBusRoute} --axis y --line 0.55 --in-direction down`}</code></pre>
      <p className="live-camera-message">For an overhead camera, adjust the line and entering direction after a short test. Use <code>--axis x --in-direction right</code> for a side-on view. Press <code>q</code> to stop.</p>
      <p className="live-camera-privacy">Frames are processed locally and never uploaded; only aggregate doorway counts are sent to the API. These crossings estimate boarding/alighting and onboard occupancy—not the number of people waiting at the stop.</p>
    </div>
  )
}
