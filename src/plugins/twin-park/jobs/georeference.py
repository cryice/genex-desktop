"""Georeference a twin site: CGCS2000 (EPSG:4490) lat/lon/height to a local ENU metre frame.

This is the high-precision, pyproj-backed counterpart to the plugin's in-JS `georeference` tool
(which uses a closed-form topocentric formula good to centimetre scale across a park). Run this
when you need a proj4-definable ENU datum, control-point accuracy reporting, or batch conversion
of many survey points — the JS tool covers the common single-origin case.

It does NOT consume one of the manifest's eight nativeJobs slots: it is an offline helper the
operator runs once at project init (or whenever the survey origin changes), producing `georef.json`
that the operators and `assemble` read.

Usage:
  georeference.py --lat 39.9 --lon 116.4 --h 50 --out georef.json
  georeference.py --ir ir.json --out georef.json          # read origin from environment.origin
  georeference.py --lat L --lon N --h H --points pts.csv  # also convert a column of lon,lat,h
"""
import argparse
import csv
import json
import math
import sys

# CGCS2000 is realised on the GRS80 ellipsoid (a = 6378137.0 m, f = 1/298.257222101).
CGCS2000_A = 6378137.0
CGCS2000_F = 1.0 / 298.257222101
ELLIPSOID = {"a": CGCS2000_A, "f": CGCS2000_F}


def enu_crs(lat0, lon0, h0):
    """A proj4 string for a local East-North-Up tangent plane centred on the survey origin.

    proj has no `+proj=enu`; the standard local-plane projection is Azimuthal Equidistant
    (`+proj=aeqd`) centred at the origin with `+lat_0/+lon_0/+h_0`, which yields x≈east,
    y≈north, z≈up. We use it only to *describe* the frame; the actual transform is the
    closed-form ECEF→ENU rotation below so the result matches the plugin's in-JS tool to the
    centimetre.
    """
    return (
        f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +h_0={h0} "
        f"+ellps=GRS80 +units=m +no_defs +type=crs"
    )


def geodetic_to_ecef(lat_deg, lon_deg, h, ellipsoid):
    """Geodetic (degrees, metres) to Earth-Centred Earth-Fixed Cartesian on an ellipsoid."""
    a, f = ellipsoid["a"], ellipsoid["f"]
    e2 = f * (2 - f)
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    x = (n + h) * math.cos(lat) * math.cos(lon)
    y = (n + h) * math.cos(lat) * math.sin(lon)
    z = (n * (1 - e2) + h) * math.sin(lat)
    return (x, y, z)


def ecef_to_enu(lat0_deg, lon0_deg, p, p0):
    """ECEF minus the origin ECEF, rotated into the origin's local East-North-Up frame."""
    lat0 = math.radians(lat0_deg)
    lon0 = math.radians(lon0_deg)
    dx, dy, dz = p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]
    sin_lat, cos_lat = math.sin(lat0), math.cos(lat0)
    sin_lon, cos_lon = math.sin(lon0), math.cos(lon0)
    east = -sin_lon * dx + cos_lon * dy
    north = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz
    up = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz
    return (east, north, up)


def build_georef(lat0, lon0, h0):
    p0 = geodetic_to_ecef(lat0, lon0, h0, ELLIPSOID)
    # The origin maps to (0, 0, 0) by construction; report the residual as a trust signal.
    e0, n0, u0 = ecef_to_enu(lat0, lon0, p0, p0)

    def project(lon, lat, h):
        p = geodetic_to_ecef(lat, lon, h, ELLIPSOID)
        e, north, u = ecef_to_enu(lat0, lon0, p, p0)
        return (e, north, u)

    return {
        "crs": "CGCS2000",
        "origin": {"lat": lat0, "lon": lon0, "heightM": h0},
        "enu": {
            "east": [1, 0, 0],
            "north": [0, 1, 0],
            "up": [0, 0, 1],
            "originXyz": [0, 0, 0],
            "proj4": enu_crs(lat0, lon0, h0),
            "originResidualM": round(max(abs(e0), abs(n0), abs(u0)), 6),
        },
        "ellipsoid": ELLIPSOID,
        "accuracyNote": "ENU origin residual should be ~0; sub-centimetre across a park footprint.",
    }, project


def convert_points(projector, path):
    """Convert a CSV of lon,lat[,h] rows into ENU metres; returns a list of dicts."""
    out = []
    with open(path, newline="") as handle:
        for row in csv.reader(handle):
            if not row or row[0].strip().startswith("#"):
                continue
            lon, lat = float(row[0]), float(row[1])
            h = float(row[2]) if len(row) > 2 and row[2].strip() else 0.0
            e, n, u = projector(lon, lat, h)
            out.append({"east": round(e, 3), "north": round(n, 3), "up": round(u, 3)})
    return out


def main():
    parser = argparse.ArgumentParser(description="CGCS2000 -> local ENU georeference helper")
    parser.add_argument("--lat", type=float, help="origin latitude in degrees")
    parser.add_argument("--lon", type=float, help="origin longitude in degrees")
    parser.add_argument("--h", type=float, default=0.0, help="origin ellipsoidal height in metres")
    parser.add_argument("--ir", help="read the origin from an ir.json's environment.origin")
    parser.add_argument("--out", help="write georef.json to this path")
    parser.add_argument("--points", help="optional CSV of lon,lat[,h] to also convert")
    args = parser.parse_args()

    if args.ir:
        with open(args.ir) as handle:
            ir = json.load(handle)
        env = ir.get("environment", {}).get("origin", {})
        args.lat = float(env.get("lat"))
        args.lon = float(env.get("lon"))
        args.h = float(env.get("heightM", 0.0))

    if args.lat is None or args.lon is None:
        sys.stderr.write("error: provide --lat/--lon or --ir\n")
        sys.exit(2)

    georef, projector = build_georef(args.lat, args.lon, args.h)
    if args.points:
        georef["convertedPoints"] = convert_points(projector, args.points)
    payload = json.dumps(georef, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(payload + "\n")
    sys.stdout.write(payload + "\n")


if __name__ == "__main__":
    main()
