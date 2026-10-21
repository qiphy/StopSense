import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

import main
from bus_counter import LineCrossingCounter, payload


class PassengerCountApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.db_patch = patch.object(main, "DB_PATH", self.db_path)
        self.db_patch.start()
        main.initialize_db()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def test_latest_camera_counts_are_upserted_and_separate_from_waiting_crowd(self):
        report = {
            "camera_id": "bus-door-01",
            "observed_at": "2026-10-21T00:00:00+00:00",
            "boarding_count": 4,
            "alighting_count": 2,
            "confidence": 0.84,
            "status": "ok",
        }
        main.receive_passenger_count(main.PassengerCount(**report))
        updated = {**report, "boarding_count": 5}
        main.receive_passenger_count(main.PassengerCount(**updated))
        listing = main.list_passenger_counts(camera_id="bus-door-01")["items"]
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing[0]["boarding_count"], 5)
        self.assertEqual(listing[0]["alighting_count"], 2)
        self.assertEqual(listing[0]["confidence"], 0.84)
        self.assertNotIn("crowd_level", listing[0])
        routes = [route for route in main.app.routes if route.path == "/passenger-counts"]
        self.assertEqual({method for route in routes for method in route.methods}, {"GET", "POST"})

    def test_invalid_counts_and_confidence_are_rejected(self):
        with self.assertRaises(ValidationError):
            main.PassengerCount(
                camera_id="door",
                observed_at="2026-10-21T00:00:00+00:00",
                boarding_count=-1,
                alighting_count=0,
                confidence=1.5,
                status="ok",
            )

    def test_legacy_telemetry_payload_still_works_without_new_fields(self):
        reading = main.Reading(
            device_id="stop-legacy",
            timestamp=datetime.fromisoformat("2026-10-21T00:00:00+00:00"),
            temperature_c=31.2,
            humidity_pct=72,
            water_level_pct=85,
            power_w=14.6,
            cooler_on=True,
        )
        self.assertEqual(main.receive_telemetry(reading)["device_id"], "stop-legacy")
        stored = main.list_telemetry(limit=200, device_id="stop-legacy")["items"][0]
        self.assertEqual(stored["crowd_level"], "Unknown")
        self.assertEqual(stored["crowd_source"], "unknown")
        self.assertNotIn("boarding_count", stored)


class LineCrossingTests(unittest.TestCase):
    def test_counts_each_track_once_and_emits_confidence_payload(self):
        counter = LineCrossingCounter(0.55, "y", "down", hysteresis=5)
        self.assertIsNone(counter.update(1, 50, 30, 100, 100, confidence=0.8))
        self.assertEqual(counter.update(1, 50, 70, 100, 100, confidence=0.9), "boarding")
        self.assertIsNone(counter.update(1, 50, 85, 100, 100, confidence=0.9))
        self.assertEqual(counter.update(2, 50, 80, 100, 100, confidence=0.85), None)
        self.assertEqual(counter.update(2, 50, 30, 100, 100, confidence=0.85), "alighting")
        self.assertEqual(counter.boardings, 1)
        self.assertEqual(counter.alightings, 1)
        result = payload(counter, "door-1", "ok")
        self.assertEqual(result["confidence"], 0.875)
        self.assertEqual(result["status"], "ok")


if __name__ == "__main__":
    unittest.main()
