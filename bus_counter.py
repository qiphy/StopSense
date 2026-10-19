"""Estimate bus boardings and alightings from a doorway camera stream.

Runs person detection and tracking locally; frames are not saved or transmitted.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from typing import Literal


@dataclass
class TrackState:
    side: int
    last_seen: float
    counted: bool = False


class LineCrossingCounter:
    """Count each tracked person once when they cross a virtual doorway line."""

    def __init__(self, line: float, axis: Literal["x", "y"], in_direction: str, hysteresis: float = 12.0):
        self.line = line
        self.axis = axis
        self.in_direction = in_direction
        self.hysteresis = hysteresis
        self.tracks: dict[int, TrackState] = {}
        self.boardings = 0
        self.alightings = 0

    def update(self, track_id: int, x: float, y: float, frame_width: int, frame_height: int,
               now: float | None = None) -> str | None:
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
        if previous.counted:
            return None
        previous.counted = True

        positive_is_in = self.in_direction in {"right", "down"}
        entering = (side > 0) == positive_is_in
        if entering:
            self.boardings += 1
            return "boarding"
        self.alightings += 1
        return "alighting"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Count bus boardings/alightings at a virtual line.")
    parser.add_argument("--source", default="0", help="Camera index, video file, or stream URL (default: 0)")
    parser.add_argument("--model", default="yolo11n.pt", help="Ultralytics YOLO model (default downloads yolo11n.pt)")
    parser.add_argument("--axis", choices=("x", "y"), default="y",
                        help="Direction axis: y for overhead view; x for side view")
    parser.add_argument("--line", type=float, default=0.55,
                        help="Normalized crossing-line position from 0.0 to 1.0 (default: 0.55)")
    parser.add_argument("--in-direction", choices=("left", "right", "up", "down"), default="down",
                        help="Which way across the line means entering the bus")
    parser.add_argument("--hysteresis", type=float, default=12,
                        help="Dead-band around the line, in pixels, to reduce jitter counts")
    parser.add_argument("--no-display", action="store_true", help="Run without an OpenCV preview window")
    args = parser.parse_args()
    if not 0 < args.line < 1:
        parser.error("--line must be between 0 and 1")
    if args.hysteresis < 0:
        parser.error("--hysteresis cannot be negative")
    if args.in_direction not in ({"left", "right"} if args.axis == "x" else {"up", "down"}):
        parser.error("--in-direction must match --axis (left/right for x, up/down for y)")
    return args


def main() -> None:
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install optional camera dependencies: python -m pip install opencv-python ultralytics") from exc

    args = parse_args()
    source: int | str = int(args.source) if args.source.isdecimal() else args.source
    capture = cv2.VideoCapture(source)
    if not capture.isOpened():
        raise SystemExit(f"Could not open video source: {args.source}")

    model = YOLO(args.model)
    counter = LineCrossingCounter(args.line, args.axis, args.in_direction, args.hysteresis)
    print("Counting locally. Press q to stop. Check direction with a short test before relying on counts.")

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            height, width = frame.shape[:2]
            result = model.track(frame, persist=True, classes=[0], tracker="bytetrack.yaml",
                                 verbose=False)[0]
            if result.boxes is not None and result.boxes.id is not None:
                boxes = result.boxes.xyxy.cpu().tolist()
                ids = result.boxes.id.int().cpu().tolist()
                for box, track_id in zip(boxes, ids):
                    x1, y1, x2, y2 = box
                    center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
                    event = counter.update(track_id, center_x, center_y, width, height)
                    if event:
                        print(f"{event}: boardings={counter.boardings}, alightings={counter.alightings}")
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (40, 200, 40), 2)
                    cv2.putText(frame, f"ID {track_id}", (int(x1), max(20, int(y1) - 6)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 200, 40), 1)

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
                    break
    finally:
        capture.release()
        if not args.no_display:
            cv2.destroyAllWindows()
    print(f"Final totals: boardings={counter.boardings}, alightings={counter.alightings}")


if __name__ == "__main__":
    main()
