"""Extract the 2026-11-24 Guangxi–Shenzhen flight from its original GPSTest log.

Usage: python3 prepare.py /path/to/gnss_log_2026_11_24_14_38_44.txt
Static output: dist/data/flight.json. All t fields are seconds since startUnixMs.
h = WGS84 ellipsoid height; alt = GGA mean sea level height (meters).
Speed is in km/h. Distances are horizontal great-circle distances in km.
"""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from functools import reduce
import json
from math import asin, cos, radians, sin, sqrt
from operator import xor
from pathlib import Path

START = datetime.fromisoformat("2026-11-24T14:38:33+08:00")
END = datetime.fromisoformat("2026-11-24T15:41:42+08:00")
GAP_THRESHOLD = 5


def degrees(value, hemisphere):
    ddmm = float(value)
    decimal = int(ddmm / 100) + (ddmm % 100) / 60
    return round(-decimal if hemisphere in ("S", "W") else decimal, 8)


def distance_km(a, b):
    lat_a, lat_b = radians(a["lat"]), radians(b["lat"])
    dlon = radians(b["lon"] - a["lon"])
    hav = sin((lat_b - lat_a) / 2) ** 2 + cos(lat_a) * cos(lat_b) * sin(dlon / 2) ** 2
    return 12742 * asin(min(1, sqrt(hav)))


def parse(path):
    fixes = {}
    bursts = defaultdict(dict)
    with path.open(encoding="utf-8") as stream:
        for row in stream:
            if row.startswith("Fix,gps,"):
                fields = row.strip().split(",")
                timestamp = int(fields[8]) / 1000
                if START.timestamp() <= timestamp <= END.timestamp() and fields[13] == "0":
                    fixes[timestamp] = fields
                continue
            if not row.startswith(("NMEA,$GNRMC,", "NMEA,$GNGGA,", "NMEA,$GNGNS,")):
                continue
            sentence, receipt = row.strip()[5:].rsplit(",", 1)
            body, checksum = sentence[1:].rsplit("*", 1)
            if reduce(xor, body.encode("ascii"), 0) != int(checksum, 16):
                continue
            fields = body.split(",")
            if not fields[1]:
                continue
            # One UTC day, one GN talker; use the time inside the sentence.
            # The phone's receipt epoch can precede or follow the measured fix.
            bursts[fields[1]][fields[0][2:]] = (fields, row.strip())

    by_time = {}
    for burst in bursts.values():
        if "RMC" not in burst or "GGA" not in burst:
            continue
        rmc, raw_rmc = burst["RMC"]
        gga, raw_gga = burst["GGA"]
        if rmc[2] != "A" or not int(gga[6] or 0):
            continue
        dt = datetime.strptime(rmc[9] + rmc[1], "%d%m%y%H%M%S.%f").replace(tzinfo=timezone.utc)
        timestamp = dt.timestamp()
        if not START.timestamp() <= timestamp <= END.timestamp():
            continue
        if gga[10] != "M" or gga[12] != "M":
            raise ValueError(f"Unexpected altitude unit at {dt.isoformat()}")
        alt = float(gga[9])
        point = {
            "lon": degrees(rmc[5], rmc[6]), "lat": degrees(rmc[3], rmc[4]),
            "h": round(alt + float(gga[11]), 2), "alt": alt,
            "speed": round(float(rmc[7]) * 1.852, 3) if rmc[7] else None,
            "source": "NMEA", "sv": int(gga[7]), "hdop": float(gga[8]),
            "fixQuality": int(gga[6]), "raw": [raw_rmc, raw_gga],
        }
        # GNS can expose more satellites in the multi-constellation solution
        # than the GGA satellite-count field. Preserve both original sentences.
        if "GNS" in burst:
            gns, raw_gns = burst["GNS"]
            if gns[7] and set(gns[6]) != {"N"}:
                point["sv"] = int(gns[7])
                point["raw"].append(raw_gns)
        by_time[timestamp] = point

    # The earliest isolated GPS Fix carries ellipsoid height only. Align it to
    # the same mean-sea-level datum as the NMEA GGA altitudes, using the geoid
    # separation of the nearest NMEA fix, and keep a note in the point.
    nmea_points = [(ts, p) for ts, p in by_time.items() if p.get("alt") is not None]
    for timestamp, fields in fixes.items():
        if timestamp not in by_time:
            h = round(float(fields[4]), 3)
            point = {
                "lon": float(fields[3]), "lat": float(fields[2]), "h": h,
                "alt": None, "speed": round(float(fields[5]) * 3.6, 3) if fields[5] else None,
                "source": "GPS Fix", "sv": None, "hdop": None, "fixQuality": None,
                "raw": [",".join(fields)],
            }
            if nmea_points:
                ref = min(nmea_points, key=lambda item: abs(item[0] - timestamp))[1]
                separation = ref["h"] - ref["alt"]
                point["alt"] = round(h - separation, 2)
                point["altEstimated"] = True
                point["datumNote"] = (
                    "孤立 GPS Fix 仅含椭球高；按最近 NMEA 点的大地水准面差距 "
                    f"{separation:.1f} m 换算为海拔"
                )
            by_time[timestamp] = point
    points = []
    for timestamp, point in sorted(by_time.items()):
        elapsed = timestamp - START.timestamp()
        if not elapsed.is_integer():
            raise ValueError("The selected flight contains a sub-second fix.")
        points.append(dict(t=int(elapsed), **point))
    if not points:
        raise ValueError("No valid flight points in the selected time window.")
    measured_km = 0.0
    gaps = []
    for index, (a, b) in enumerate(zip(points, points[1:])):
        period = b["t"] - a["t"]
        length = distance_km(a, b)
        if period > GAP_THRESHOLD:
            gaps.append({"from": index, "to": index + 1, "duration": period, "distanceKm": round(length, 4)})
        else:
            measured_km += length
    return {"startUnixMs": round(START.timestamp() * 1000), "duration": points[-1]["t"],
            "gapThresholdSeconds": GAP_THRESHOLD, "distanceKm": round(measured_km, 4),
            "points": points, "gaps": gaps}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    args = parser.parse_args()
    track = parse(args.log)
    out = Path(__file__).resolve().parent / "dist/data/flight.json"
    out.parent.mkdir(exist_ok=True, parents=True)
    out.write_text(json.dumps(track, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(track['points'])} fixes, {len(track['gaps'])} gaps, {track['distanceKm']:.3f} km")
