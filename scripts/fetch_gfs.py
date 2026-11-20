#!/usr/bin/env python3
"""
fetch_gfs - downloads GFS 1.0° weather layers from the NOAA open data bucket on AWS and converts them to the
JSON format read by the app (the same layout the old Java "grib2json" tool produced).

Only the GRIB2 messages that are needed are downloaded, using HTTP range requests guided by the .idx files,
so a full run is a few MB instead of the ~40 MB of the whole file.

Requirements:  pip install -r scripts/requirements.txt   (eccodes, numpy)

Usage:
    python scripts/fetch_gfs.py                      # latest available run, analysis only, also written as "current"
    python scripts/fetch_gfs.py --hours 0-24:3       # latest run, forecasts every 3 hours up to +24h
    python scripts/fetch_gfs.py --run 2026112006     # a specific run (yyyymmddhh)

Output (under public/data/weather):
    yyyy/mm/dd/hh00-<type>-<surface>-<level>-gfs-1.0.json   one file per layer, at its validity time
    current/current-<type>-...-gfs-1.0.json                 copy of the layers valid closest to now
"""
import argparse
import datetime as dt
import json
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import eccodes
import numpy as np

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "weather"
LEVELS = [1000, 850, 700, 500, 250, 70, 10]  # hPa, matching the buttons in the UI
R_DRY_AIR = 287.05  # J/(kg·K)


def layer_specs():
    """
    Returns the list of output layers. Each layer is (type, surface, level, [idx patterns]); the idx patterns
    are "VAR:level" strings matched against the GFS .idx inventory.
    """
    specs = [
        ("wind", "surface", "level", ["UGRD:10 m above ground", "VGRD:10 m above ground"]),
        ("temp", "surface", "level", ["TMP:2 m above ground"]),
        ("relative_humidity", "surface", "level", ["RH:2 m above ground"]),
        ("total_cloud_water", None, None, ["CWAT:entire atmosphere (considered as a single layer)"]),
        ("total_precipitable_water", None, None, ["PWAT:entire atmosphere (considered as a single layer)"]),
        ("mean_sea_level_pressure", None, None, ["PRMSL:mean sea level"]),
    ]
    for hpa in LEVELS:
        lvl = f"{hpa} mb"
        specs += [
            ("wind", "isobaric", f"{hpa}hPa", [f"UGRD:{lvl}", f"VGRD:{lvl}"]),
            ("temp", "isobaric", f"{hpa}hPa", [f"TMP:{lvl}"]),
            ("relative_humidity", "isobaric", f"{hpa}hPa", [f"RH:{lvl}"]),
        ]
    return specs


def http_get(url, byte_range=None, retries=3):
    headers = {"User-Agent": "earth-fetch-gfs"}
    if byte_range:
        start, end = byte_range
        headers["Range"] = f"bytes={start}-{'' if end is None else end}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == retries - 1:
                raise


def exists(url):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "earth-fetch-gfs"})
        with urllib.request.urlopen(req, timeout=30):
            return True
    except Exception:
        return False


def grib_url(run, fhour):
    return f"{BUCKET}/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.1p00.f{fhour:03d}"


def latest_run(fhours):
    """Finds the most recent run whose last needed forecast hour has been published."""
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0, tzinfo=None)
    run = now.replace(hour=now.hour - now.hour % 6)
    for _ in range(8):
        if exists(grib_url(run, max(fhours)) + ".idx"):
            return run
        run -= dt.timedelta(hours=6)
    sys.exit("No recent GFS run found on the NOAA bucket.")


def parse_idx(text):
    """Returns {"VAR:level": (start, end)} byte ranges from a GFS .idx inventory (first occurrence wins)."""
    lines = [l.split(":") for l in text.strip().splitlines()]
    ranges = {}
    for i, parts in enumerate(lines):
        key = f"{parts[3]}:{parts[4]}"
        start = int(parts[1])
        end = int(lines[i + 1][1]) - 1 if i + 1 < len(lines) else None
        ranges.setdefault(key, (start, end))
    return ranges


def decode(message_bytes):
    """Decodes one GRIB2 message into a grib2json-style record {header, data}."""
    gid = eccodes.codes_new_from_message(message_bytes)
    try:
        get = lambda k: eccodes.codes_get(gid, k)
        values = eccodes.codes_get_values(gid)
        ref = dt.datetime.strptime(f"{get('dataDate')}{get('dataTime'):04d}", "%Y%m%d%H%M")
        header = {
            "discipline": get("discipline"),
            "parameterCategory": get("parameterCategory"),
            "parameterNumber": get("parameterNumber"),
            "parameterUnit": get("units"),
            "parameterName": get("shortName"),
            "surface1Type": get("typeOfFirstFixedSurface"),
            "surface1Value": float(get("level")),
            "refTime": ref.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "forecastTime": get("forecastTime"),
            "center": 7,
            "centerName": "US National Weather Service, National Centres for Environmental Prediction (NCEP)",
            "scanMode": 0,
            "nx": get("Ni"),
            "ny": get("Nj"),
            "lo1": get("longitudeOfFirstGridPointInDegrees"),
            "la1": get("latitudeOfFirstGridPointInDegrees"),
            "lo2": get("longitudeOfLastGridPointInDegrees"),
            "la2": get("latitudeOfLastGridPointInDegrees"),
            "dx": get("iDirectionIncrementInDegrees"),
            "dy": get("jDirectionIncrementInDegrees"),
        }
        return header, np.asarray(values, dtype=np.float64)
    finally:
        eccodes.codes_release(gid)


def as_record(header, data, decimals):
    rounded = np.round(data, decimals)
    return {"header": header, "data": [None if np.isnan(v) else float(v) for v in rounded]}


def precision_for(layer_type):
    return {"total_cloud_water": 4, "air_density": 4, "mean_sea_level_pressure": 0}.get(layer_type, 2)


def file_name(stamp, layer_type, surface, level):
    return "-".join(p for p in [stamp, layer_type, surface, level, "gfs", "1.0"] if p) + ".json"


def fetch_hour(run, fhour, specs):
    url = grib_url(run, fhour)
    ranges = parse_idx(http_get(url + ".idx").decode())
    wanted = sorted({p for _, _, _, patterns in specs for p in patterns if p in ranges})
    missing = sorted({p for _, _, _, patterns in specs for p in patterns if p not in ranges})
    if missing:
        print(f"  f{fhour:03d}: not in inventory, skipped: {', '.join(missing)}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        blobs = dict(zip(wanted, pool.map(lambda key: http_get(url, ranges[key]), wanted)))
    decoded = {key: decode(blob) for key, blob in blobs.items()}

    layers = {}
    for layer_type, surface, level, patterns in specs:
        if all(p in decoded for p in patterns):
            records = [as_record(*decoded[p], precision_for(layer_type)) for p in patterns]
            layers[(layer_type, surface, level)] = records

    # Air density is not a GFS field: derive it from temperature with the ideal gas law, ρ = p / (R·T).
    for hpa in LEVELS:
        key = f"TMP:{hpa} mb"
        if key in decoded:
            header, temp = decoded[key]
            rho = (hpa * 100.0) / (R_DRY_AIR * temp)
            header = dict(header, parameterCategory=3, parameterNumber=10, parameterUnit="kg m-3",
                          parameterName="air_density")
            layers[("air_density", "isobaric", f"{hpa}hPa")] = [as_record(header, rho, 4)]
    return layers


def write_layers(layers, valid_time):
    directory = OUT / f"{valid_time:%Y}" / f"{valid_time:%m}" / f"{valid_time:%d}"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = f"{valid_time:%H}00"
    written = []
    for (layer_type, surface, level), records in layers.items():
        path = directory / file_name(stamp, layer_type, surface, level)
        path.write_text(json.dumps(records, separators=(",", ":")))
        written.append(path)
    return written


def parse_hours(spec):
    """Parses "0", "0,3,6" or "0-24:3" into a sorted list of forecast hours."""
    hours = set()
    for part in spec.split(","):
        if "-" in part:
            span, _, step = part.partition(":")
            start, end = (int(x) for x in span.split("-"))
            hours.update(range(start, end + 1, int(step or 3)))
        else:
            hours.add(int(part))
    return sorted(hours)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", help="GFS run as yyyymmddhh (default: latest available)")
    parser.add_argument("--hours", default="0", help='forecast hours, e.g. "0", "0,6,12" or "0-24:3" (default: 0)')
    parser.add_argument("--no-current", action="store_true", help='do not update the "current" layers')
    args = parser.parse_args()

    fhours = parse_hours(args.hours)
    run = dt.datetime.strptime(args.run, "%Y%m%d%H") if args.run else latest_run(fhours)
    print(f"GFS run {run:%Y-%m-%d %H}Z, forecast hours {fhours}")

    specs = layer_specs()
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    closest = None
    for fhour in fhours:
        valid_time = run + dt.timedelta(hours=fhour)
        layers = fetch_hour(run, fhour, specs)
        files = write_layers(layers, valid_time)
        print(f"  f{fhour:03d} -> {valid_time:%Y-%m-%d %H}Z: {len(files)} layers")
        if closest is None or abs(valid_time - now) < abs(closest[0] - now):
            closest = (valid_time, files)

    if not args.no_current and closest:
        current = OUT / "current"
        current.mkdir(parents=True, exist_ok=True)
        for path in closest[1]:
            name = "current-" + path.name.split("-", 1)[1]
            shutil.copyfile(path, current / name)
        print(f'  "current" now points at {closest[0]:%Y-%m-%d %H}Z')


if __name__ == "__main__":
    main()
