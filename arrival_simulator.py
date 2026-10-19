"""Deterministic headway-based bus arrival times for the dashboard demo.

These countdowns are illustrative only; they do not represent live bus GPS data.
"""

from __future__ import annotations

import math
import time


ROUTES = (
    {"route": "T1", "destination": "Town Centre", "headway_minutes": 8, "offset_seconds": 17},
    {"route": "T2", "destination": "MRT Station", "headway_minutes": 12, "offset_seconds": 103},
    {"route": "T3", "destination": "Community Mall", "headway_minutes": 15, "offset_seconds": 241},
)


def simulated_arrivals(stop_id: str, now: float | None = None) -> list[dict[str, int | str]]:
    """Return the next two scheduled demo arrivals for each route at a stop."""
    now = time.time() if now is None else now
    stop_offset = sum(ord(character) for character in stop_id) % 180
    arrivals: list[dict[str, int | str]] = []

    for route in ROUTES:
        headway_seconds = int(route["headway_minutes"]) * 60
        phase = (now + int(route["offset_seconds"]) + stop_offset) % headway_seconds
        first_eta = max(1, math.ceil(headway_seconds - phase))
        for index in range(2):
            eta_seconds = first_eta + index * headway_seconds
            arrivals.append(
                {
                    "route": str(route["route"]),
                    "destination": str(route["destination"]),
                    "eta_seconds": eta_seconds,
                    "eta_minutes": math.ceil(eta_seconds / 60),
                }
            )

    return sorted(arrivals, key=lambda arrival: int(arrival["eta_seconds"]))


def format_eta(seconds: int) -> str:
    if seconds < 60:
        return "Due" if seconds <= 10 else f"{seconds} sec"
    minutes, remaining_seconds = divmod(seconds, 60)
    if remaining_seconds < 10:
        return f"{minutes} min"
    return f"{minutes} min {remaining_seconds} sec"
