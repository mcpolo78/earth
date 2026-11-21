#!/usr/bin/env python3
"""
fetch_gfs - downloads GFS 1.0° weather layers from the NOAA open data bucket on AWS and converts them to the
compact binary format read by the app (the headers of the old Java "grib2json" JSON, plus float32 values).

Only the GRIB2 messages that are needed are downloaded, using HTTP range requests guided by the .idx files,
so a full run is a few MB instead of the ~40 MB of the whole file.

Requirements:  pip install -r scripts/requirements.txt   (eccodes, numpy)

Usage:
    python scripts/fetch_gfs.py                      # latest run, analysis + forecasts every 3 hours up to +24h
    python scripts/fetch_gfs.py --hours 0            # latest run, analysis only
    python scripts/fetch_gfs.py --run 2026112006     # a specific run (yyyymmddhh)

Output (under public/data/weather):
    yyyy/mm/dd/hh00-<type>-<surface>-<level>-gfs-1.0.bin    one file per layer, at its validity time
    current/current-<type>-...-gfs-1.0.bin                  copy of the layers valid closest to now
"""
import argparse
import datetime as dt
import json
import shutil
import struct
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
        ("precipitation_rate", None, None, ["PRATE:surface"]),
        ("snow_depth", None, None, ["SNOD:surface"]),
        ("cape", None, None, ["CAPE:surface"]),
        ("total_cloud_cover", None, None, ["TCDC:entire atmosphere"]),
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


def wave_url(run, fhour):
    return f"{BUCKET}/gfs.{run:%Y%m%d}/{run:%H}/wave/gridded/gfswave.t{run:%H}z.global.0p25.f{fhour:03d}.grib2"


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
    return header, np.round(data, decimals).astype("<f4")


def encode_layer(records):
    """
    Encodes records in the compact "EGB1" binary format read by the app (see parseBinaryLayer in src/micro.js):
    magic, uint32 LE header length, JSON array of headers, padding to 4 bytes, then float32 LE values per record.
    """
    headers = json.dumps([header for header, _ in records], separators=(",", ":")).encode()
    padding = b"\0" * ((4 - (8 + len(headers)) % 4) % 4)
    body = b"".join(values.tobytes() for _, values in records)
    return b"EGB1" + struct.pack("<I", len(headers)) + headers + padding + body


def precision_for(layer_type):
    return {"total_cloud_water": 4, "air_density": 4, "mean_sea_level_pressure": 0,
            "precipitation_rate": 7, "snow_depth": 3, "cape": 0, "total_cloud_cover": 0}.get(layer_type, 2)


def file_name(stamp, layer_type, surface, level, resolution="1.0"):
    return "-".join(p for p in [stamp, layer_type, surface, level, "gfs", resolution] if p) + ".bin"


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


WAVE_STRIDE = 2  # the 0.25° wave grid is thinned to 0.5°: plenty for the oceans, a quarter of the size


def thin(header, values, stride):
    """Keeps every stride-th grid point in both directions of a global grid."""
    grid = values.reshape(header["ny"], header["nx"])[::stride, ::stride]
    ny, nx = grid.shape
    dx, dy = header["dx"] * stride, header["dy"] * stride
    header = dict(header, nx=nx, ny=ny, dx=dx, dy=dy,
                  lo2=header["lo1"] + (nx - 1) * dx, la2=header["la1"] - (ny - 1) * dy)
    return header, grid.ravel()


def fetch_waves(run, fhour):
    """
    Fetches GFS-Wave (WAVEWATCH III) significant height, peak direction and peak period. Returns two layers:
    "waves", a vector whose direction is where the dominant waves travel and whose length is the significant
    height (m), and "wave_period", the peak period (s). Land and sea ice are NaN.
    """
    url = wave_url(run, fhour)
    try:
        ranges = parse_idx(http_get(url + ".idx").decode())
    except Exception:
        print(f"  f{fhour:03d}: no wave data, skipped")
        return {}
    keys = ["HTSGW:surface", "DIRPW:surface", "PERPW:surface"]
    if any(k not in ranges for k in keys):
        print(f"  f{fhour:03d}: wave fields missing, skipped")
        return {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        decoded = dict(zip(keys, pool.map(lambda key: decode(http_get(url, ranges[key])), keys)))

    def field(key):
        header, values = decoded[key]
        values = np.where(values >= 9999, np.nan, values)  # WAVEWATCH III marks land with 9999
        return thin(header, values, WAVE_STRIDE)

    h_header, height = field("HTSGW:surface")
    h_header = dict(h_header, center=None, centerName="GFS-Wave / NCEP / US National Weather Service")
    _, direction = field("DIRPW:surface")
    p_header, period = field("PERPW:surface")
    p_header = dict(p_header, center=None, centerName=h_header["centerName"])
    # DIRPW is the direction the waves come FROM, clockwise from north; they travel the opposite way.
    to = np.radians(direction + 180.0)
    u, v = height * np.sin(to), height * np.cos(to)
    u_header = dict(h_header, parameterName="u_waves")
    v_header = dict(h_header, parameterName="v_waves")
    return {
        ("waves", "surface", "level"): [as_record(u_header, u, 2), as_record(v_header, v, 2)],
        ("wave_period", "surface", "level"): [as_record(p_header, period, 1)],
    }


GEFS_BUCKET = "https://noaa-gefs-pds.s3.amazonaws.com"

# GEFS-Aerosols (NOAA's global aerosol forecast, the keyless counterpart of CAMS). Its .idx lists several aerosol
# types under one variable name, so each layer is matched on the variable and on text from the rest of the line.
AEROSOL_LAYERS = [
    # (layer type, variable:level, required text, scale factor, decimals)
    ("pm2_5", "PMTF:surface", "aerosol=Total aerosol:aerosol_size <2.5e-06", 1, 1),  # already µg/m³
    ("pm10", "PMTC:surface", "aerosol=Total aerosol:aerosol_size <1e-05", 1, 1),
    ("aerosol_optical_depth", "AOTK:entire atmosphere", "aerosol=Total aerosol:aerosol_size <2e-05:aerosol_wavelength >=5.45e-07,<=5.65e-07", 1, 3),
    ("dust_optical_depth", "AOTK:entire atmosphere", "aerosol=Dust dry:aerosol_size <2e-05:aerosol_wavelength >=5.45e-07,<=5.65e-07", 1, 3),
]
AEROSOL_UNITS = {"pm2_5": "µg m-3", "pm10": "µg m-3", "aerosol_optical_depth": "1", "dust_optical_depth": "1"}


def aerosol_url(run, fhour):
    return f"{GEFS_BUCKET}/gefs.{run:%Y%m%d}/{run:%H}/chem/pgrb2ap25/gefs.chem.t{run:%H}z.a2d_0p25.f{fhour:03d}.grib2"


def latest_aerosol_run(last_valid_time):
    """Finds the most recent GEFS-Aerosols run that already covers last_valid_time."""
    run = last_valid_time.replace(hour=last_valid_time.hour - last_valid_time.hour % 6)
    for _ in range(12):
        fhour = int((last_valid_time - run).total_seconds() // 3600)
        if fhour >= 0 and fhour % 3 == 0 and exists(aerosol_url(run, fhour) + ".idx"):
            return run
        run -= dt.timedelta(hours=6)
    return None


def parse_full_idx(text):
    """Returns [(line, start, end)] from an .idx inventory, keeping every line (variables can repeat)."""
    lines = text.strip().splitlines()
    starts = [int(l.split(":")[1]) for l in lines]
    return [(l, starts[i], starts[i + 1] - 1 if i + 1 < len(lines) else None) for i, l in enumerate(lines)]


def fetch_aerosols(run, valid_time):
    """Fetches surface PM2.5 and PM10 (µg/m³) and the total and dust aerosol optical depths at 550 nm."""
    fhour = int((valid_time - run).total_seconds() // 3600)
    url = aerosol_url(run, fhour)
    try:
        inventory = parse_full_idx(http_get(url + ".idx").decode())
    except Exception:
        print(f"  {valid_time:%d %H}Z: no aerosol data, skipped")
        return {}
    wanted = {}
    for layer_type, var, text, factor, decimals in AEROSOL_LAYERS:
        for line, start, end in inventory:
            if f":{var}:" in line and text in line:
                wanted[layer_type] = (start, end, factor, decimals)
                break
    with ThreadPoolExecutor(max_workers=4) as pool:
        decoded = dict(zip(wanted, pool.map(lambda k: decode(http_get(url, wanted[k][:2])), wanted)))
    layers = {}
    for layer_type, (_, _, factor, decimals) in wanted.items():
        header, values = decoded[layer_type]
        header, values = thin(header, values * factor, WAVE_STRIDE)
        header = dict(header, parameterName=layer_type, parameterUnit=AEROSOL_UNITS[layer_type], center=None,
                      centerName="GEFS-Aerosols / NCEP / US National Weather Service")
        layers[(layer_type, None, None)] = [as_record(header, values, decimals)]
    return layers


def write_layers(layers, valid_time, resolution="1.0"):
    directory = OUT / f"{valid_time:%Y}" / f"{valid_time:%m}" / f"{valid_time:%d}"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = f"{valid_time:%H}00"
    written = []
    for (layer_type, surface, level), records in layers.items():
        path = directory / file_name(stamp, layer_type, surface, level, resolution)
        path.write_bytes(encode_layer(records))
        written.append(path)
    return written


def write_catalog():
    """
    Lists the validity times that have data (a surface wind layer) in public/data/weather/catalog.json, so the
    app's time slider knows which steps exist: {"times": ["2026-11-20T18:00:00Z", ...]}.
    """
    times = []
    for path in sorted(OUT.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]/*-wind-surface-level-gfs-1.0.bin")):
        year, month, day = path.parts[-4:-1]
        times.append(f"{year}-{month}-{day}T{path.name[:2]}:00:00Z")
    (OUT / "catalog.json").write_text(json.dumps({"times": times}, indent=1))
    return times


def prune(keep_days):
    """Deletes dated layer directories older than keep_days."""
    limit = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=keep_days)).strftime("%Y/%m/%d")
    for day in OUT.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]"):
        if "/".join(day.parts[-3:]) < limit:
            shutil.rmtree(day)


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
    parser.add_argument("--hours", default="0-24:3",
                        help='forecast hours, e.g. "0", "0,6,12" or "0-48:3" (default: 0-24:3)')
    parser.add_argument("--keep-days", type=int, default=3, help="delete data older than this many days (default: 3)")
    parser.add_argument("--no-aerosols", action="store_true", help="skip the GEFS-Aerosols air quality layers")
    parser.add_argument("--no-waves", action="store_true", help="skip the GFS-Wave ocean layers")
    parser.add_argument("--no-current", action="store_true", help='do not update the "current" layers')
    args = parser.parse_args()

    fhours = parse_hours(args.hours)
    run = dt.datetime.strptime(args.run, "%Y%m%d%H") if args.run else latest_run(fhours)
    print(f"GFS run {run:%Y-%m-%d %H}Z, forecast hours {fhours}")

    specs = layer_specs()
    last_valid = run + dt.timedelta(hours=max(fhours))
    aerosol_run = None if args.no_aerosols else latest_aerosol_run(last_valid)
    if aerosol_run:
        print(f"GEFS-Aerosols run {aerosol_run:%Y-%m-%d %H}Z")
    elif not args.no_aerosols:
        print("No GEFS-Aerosols run covers these hours: air quality skipped")
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    closest = None
    for fhour in fhours:
        valid_time = run + dt.timedelta(hours=fhour)
        layers = fetch_hour(run, fhour, specs)
        files = write_layers(layers, valid_time)
        if not args.no_waves:
            files += write_layers(fetch_waves(run, fhour), valid_time, "0.5")
        if aerosol_run:
            files += write_layers(fetch_aerosols(aerosol_run, valid_time), valid_time, "0.5")
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

    prune(args.keep_days)
    times = write_catalog()
    print(f"  catalog: {len(times)} time steps available")


if __name__ == "__main__":
    main()
