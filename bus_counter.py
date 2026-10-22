"""Estimate current occupancy and crossings from a camera stream.

Runs person detection and tracking locally; frames are not saved or transmitted.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass
class TrackState:
    side: int
    last_seen: float


class LineCrossingCounter:
    """Estimate occupancy from tracked people crossing a virtual boundary."""

    def __init__(self, line: float, axis: Literal["x", "y"], in_direction: str, hysteresis: float = 12.0,
                 initial_occupancy: int = 0):
        if initial_occupancy < 0:
            raise ValueError("initial_occupancy cannot be negative")
        self.line = line
        self.axis = axis
        self.in_direction = in_direction
        self.hysteresis = hysteresis
        self.tracks: dict[int, TrackState] = {}
        self.boardings = 0
        self.alightings = 0
        self.occupancy_count = initial_occupancy
        self._crossing_confidence_sum = 0.0
        self._crossing_count = 0

    @property
    def confidence(self) -> float:
        if not self._crossing_count:
            return 0.0
        return self._crossing_confidence_sum / self._crossing_count

    def update(self, track_id: int, x: float, y: float, frame_width: int, frame_height: int,
               confidence: float = 0.0, now: float | None = None) -> str | None:
        now = time.monotonic() if now is None else now
        coordinate = x if self.axis == "x" else y
        extent = frame_width if self.axis == "x" else frame_height
        offset = coordinate - self.line * extent
        side = 1 if offset > self.hysteresis else -1 if offset < -self.hysteresis else 0

        for old_id, state in list(self.tracks.items()):
            if now - state.last_seen > 10:
                del self.tracks[old_id]

        previous = self.tracks.get(track_id)
        if previous is None:
            if side:
                self.tracks[track_id] = TrackState(side=side, last_seen=now)
            return None

        previous.last_seen = now
        if not side or side == previous.side:
            return None

        previous.side = side
        self._crossing_confidence_sum += min(1.0, max(0.0, confidence))
        self._crossing_count += 1

        positive_is_in = self.in_direction in {"right", "down"}
        entering = (side > 0) == positive_is_in
        if entering:
            self.boardings += 1
            self.occupancy_count += 1
            return "boarding"
        self.alightings += 1
        self.occupancy_count = max(0, self.occupancy_count - 1)
        return "alighting"


def payload(counter: LineCrossingCounter, camera_id: str, status: str) -> dict[str, object]:
    return {
        "camera_id": camera_id,
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "boarding_count": counter.boardings,
        "alighting_count": counter.alightings,
        "occupancy_count": counter.occupancy_count,
        "confidence": round(counter.confidence, 3),
        "status": status,
    }


def publish(api_url: str, report: dict[str, object]) -> None:
    if not api_url:
        return
    request = Request(
        f"{api_url.rstrip('/')}/passenger-counts",
        data=json.dumps(report).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=3) as response:
            if response.status not in {200, 201}:
                print(f"Passenger count API returned HTTP {response.status}")
    except (HTTPError, URLError, TimeoutError) as error:
        print(f"Could not publish passenger counts: {error}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Estimate people crossing into and out of a monitored camera area.")
    parser.add_argument("--source", default="0", help="Camera index, video file, or stream URL (default: 0)")
    parser.add_argument("--model", default=os.environ.get("PASSENGER_MODEL", "yolo11n.pt"),
                        help="Local Ultralytics model path or model name (default yolo11n.pt)")
    parser.add_argument("--tracker", default="bytetrack.yaml",
                        help="Ultralytics tracker config path/name (default bytetrack.yaml)")
    parser.add_argument("--confidence", type=float, default=0.25,
                        help="Minimum person detection confidence from 0 to 1")
    parser.add_argument("--api-url", default=os.environ.get("PASSENGER_COUNT_API_URL", "http://127.0.0.1:8000"),
                        help="Base URL of FastAPI server; empty disables count publishing")
    parser.add_argument("--camera-id", default=os.environ.get("PASSENGER_CAMERA_ID", "bus-door-01"))
    parser.add_argument("--publish-interval", type=float, default=2.0,
                        help="Seconds between count updates sent to the API")
    parser.add_argument("--axis", choices=("x", "y"), default="y",
                        help="Direction axis: y for overhead view; x for side view")
    parser.add_argument("--line", type=float, default=0.55,
                        help="Normalized crossing-line position from 0.0 to 1.0 (default: 0.55)")
    parser.add_argument("--in-direction", choices=("left", "right", "up", "down"), default="down",
                        help="Which way across the line means entering the monitored area")
    parser.add_argument("--hysteresis", type=float, default=12,
                        help="Dead-band around the line, in pixels, to reduce jitter counts")
    parser.add_argument("--initial-occupancy", type=int, default=0,
                        help="Starting people count; default assumes the monitored area starts empty")
    parser.add_argument("--no-display", action="store_true", help="Run without an OpenCV preview window")
    parser.add_argument("--self-test", action="store_true",
                        help="Exercise line crossing logic offline without a camera/model")
    args = parser.parse_args()
    if not 0 < args.line < 1:
        parser.error("--line must be between 0 and 1")
    if args.hysteresis < 0:
        parser.error("--hysteresis cannot be negative")
    if args.initial_occupancy < 0:
        parser.error("--initial-occupancy cannot be negative")
    if not 0 <= args.confidence <= 1:
        parser.error("--confidence must be between 0 and 1")
    if args.publish_interval <= 0:
        parser.error("--publish-interval must be positive")
    if args.in_direction not in ({"left", "right"} if args.axis == "x" else {"up", "down"}):
        parser.error("--in-direction must match --axis (left/right for x, up/down for y)")
    return args


def main() -> None:
    args = parse_args()
    if args.self_test:
        counter = LineCrossingCounter(0.55, "y", "down", hysteresis=5, initial_occupancy=2)
        counter.update(1, 50, 30, 100, 100, confidence=0.8)
        counter.update(1, 50, 70, 100, 100, confidence=0.9)
        counter.update(1, 50, 85, 100, 100, confidence=0.9)
        counter.update(2, 50, 80, 100, 100, confidence=0.85)
        counter.update(2, 50, 30, 100, 100, confidence=0.85)
        result = {
            "boarding_count": counter.boardings,
            "alighting_count": counter.alightings,
            "occupancy_count": counter.occupancy_count,
            "confidence": round(counter.confidence, 3),
        }
        print(json.dumps(result, indent=2))
        if counter.boardings != 1 or counter.alightings != 1 or counter.occupancy_count != 2:
            raise SystemExit("Offline crossing self-test failed")
        return

    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit(
            "Install optional camera dependencies: python -m pip install opencv-python ultralytics"
        ) from exc

    source: int | str = int(args.source) if args.source.isdecimal() else args.source
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        raise SystemExit(f"Could not open video source: {args.source}")

    counter = LineCrossingCounter(
        args.line, args.axis, args.in_direction, args.hysteresis,
        initial_occupancy=args.initial_occupancy,
    )
    last_publish = 0.0
    status = "ok"
    print("Counting locally. Press q to stop. Check direction with a short test before relying on counts.")

    try:
        model = YOLO(args.model)
        while True:
            ok, frame = capture.read()
            if not ok:
                status = "offline"
                break
            height, width = frame.shape[:2]
            result = model.track(
                frame, persist=True, classes=[0], conf=args.confidence,
                tracker=args.tracker, verbose=False,
            )[0]
            if result.boxes is not None and result.boxes.id is not None:
                boxes = result.boxes.xyxy.cpu().tolist()
                ids = result.boxes.id.int().cpu().tolist()
                scores = result.boxes.conf.cpu().tolist()
                for box, track_id, score in zip(boxes, ids, scores):
                    x1, y1, x2, y2 = box
                    center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
                    event = counter.update(
                        track_id, center_x, center_y, width, height, confidence=float(score)
                    )
                    if event:
                        print(f"{event}: boardings={counter.boardings}, alightings={counter.alightings}")
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (40, 200, 40), 2)
                    cv2.putText(frame, f"ID {track_id}", (int(x1), max(20, int(y1) - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 200, 40), 1)

            now = time.monotonic()
            if args.api_url and now - last_publish >= args.publish_interval:
                publish(args.api_url, payload(counter, args.camera_id, status))
                last_publish = now

            if args.axis == "y":
                line_y = int(args.line * height)
                cv2.line(frame, (0, line_y), (width, line_y), (0, 200, 255), 2)
            else:
                line_x = int(args.line * width)
                cv2.line(frame, (line_x, 0), (line_x, height), (0, 200, 255), 2)
            cv2.putText(frame, f"IN {counter.boardings}  OUT {counter.alightings}", (20, 35),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

            if not args.no_display:
                cv2.imshow("Bus doorway counter (q to quit)", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    status = "offline"
                    break
    except KeyboardInterrupt:
        status = "offline"
    except Exception:
        status = "error"
        raise
    finally:
        capture.release()
        if not args.no_display:
            cv2.destroyAllWindows()
        publish(args.api_url, payload(counter, args.camera_id, status))
    print(f"Final totals: boardings={counter.boardings}, alightings={counter.alightings}")


if __name__ == "__main__":
    main()
