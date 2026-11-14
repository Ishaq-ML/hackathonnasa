"""Build compact provider snapshots for the worldwide map."""
import argparse
import csv
from datetime import timezone
from email.utils import parsedate_to_datetime
import io
import json
import math
from pathlib import Path
import re
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import zipfile

OUTPUT = Path(__file__).resolve().parents[1] / "public/data"
USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson"
GDACS = "https://www.gdacs.org/xml/rss.xml"


def fetch(url):
    with urlopen(url, timeout=30) as response:
        return response.read()


def write(name, data):
    (OUTPUT / (name + ".json")).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))


def quakes(raw):
    return {
        "updated": raw["metadata"]["generated"],
        "items": [[f["id"], *f["geometry"]["coordinates"][:3], p["mag"], p["time"],
                   p["place"] or "Earthquake"]
                  for f in raw["features"] if (p := f["properties"]).get("type") == "earthquake"]
    }


def floods(raw):
    items = {}
    for node in ET.fromstring(raw).findall(".//item"):
        p = {child.tag.split("}")[-1]: child.text for child in node}
        if p.get("eventtype") != "FL" or not p.get("point"):
            continue
        event_id = p["eventid"]
        if not re.fullmatch(r"\d+", event_id):
            continue
        lat, lon = map(float, p["point"].split())
        start = parsedate_to_datetime(p["fromdate"]).astimezone(timezone.utc).date().isoformat()
        end = parsedate_to_datetime(p["todate"]).astimezone(timezone.utc).date().isoformat()
        items.setdefault(event_id, [event_id, lon, lat, p["country"], start, end, p["episodealertlevel"]])
    return {"items": list(items.values())}


def glaciers(path):
    latest = {}
    with zipfile.ZipFile(path) as archive:
        with archive.open("data/mass_balance.csv") as raw:
            for record in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")):
                if not record["annual_balance"]:
                    continue
                gid = record["glacier_id"]
                year = int(record["year"])
                value = float(record["annual_balance"])
                if year >= 2000 and math.isfinite(value):
                    latest.setdefault(gid, {}).setdefault(year, round(value, 3))
        result = []
        with archive.open("data/glacier.csv") as raw:
            for record in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig")):
                series = latest.get(record["id"])
                if not series or not record["latitude"] or not record["longitude"]:
                    continue
                name = record["names"].split("|")[0].strip() or record["short_name"]
                years = sorted(series)[-12:]
                lat = float(record["latitude"])
                lon = float(record["longitude"])
                if abs(lat) > 85.05 or abs(lon) > 180:
                    continue
                result.append([record["id"], round(lon, 5), round(lat, 5), name,
                               record["country"], [[year, series[year]] for year in years]])
    return {"release": "2026-02-10", "items": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wgms_zip", type=Path, help="WGMS FoG 2026-02-10 ZIP")
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    write("world-quakes", quakes(json.loads((args.cache / "quake").read_bytes() if args.cache else fetch(USGS))))
    write("world-floods", floods((args.cache / "gdacs-rss").read_bytes() if args.cache else fetch(GDACS)))
    write("world-glaciers", glaciers(args.wgms_zip))
