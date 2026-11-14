"""Stage and verify public NISAR GIBS daily browse crops for TerraPulse."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import math
from urllib.parse import urlencode
from urllib.request import urlopen

from PIL import Image

OUTPUT = Path(__file__).resolve().parents[1] / "public/data"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
SERIES = {
    "guelma": ((7.37, 36.43, 7.48, 36.53), ("2026-09-06", "2026-09-18", "2026-09-30")),
    "reghaia": ((3.31, 36.76, 3.37, 36.82), ("2026-09-20", "2026-10-02", "2026-10-14")),
    "pine": ((-102, -75.7, -100, -74.85), ("2026-10-03", "2026-10-15")),
}


def mercator_y(latitude):
    return 6378137 * math.asinh(math.tan(math.radians(latitude)))


def stage(task, cache):
    name, bounds, date = task
    west, south, east, north = bounds
    query = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.1.1",
        "LAYERS": "NISAR_L2_Geocoded_Polarimetric_Covariance", "STYLES": "",
        "FORMAT": "image/png", "TRANSPARENT": "TRUE", "SRS": "EPSG:3857",
        "BBOX": ",".join(map(str, (west * 111319.49079327358, mercator_y(south),
                                   east * 111319.49079327358, mercator_y(north)))),
        "WIDTH": 480, "HEIGHT": 480, "TIME": date,
    }
    if cache:
        data = (cache / f"{name}{date}.png").read_bytes()
    else:
        with urlopen(WMS + "?" + urlencode(query), timeout=30) as response:
            data = response.read()
    with Image.open(BytesIO(data)) as image:
        rgba = image.convert("RGBA")
        if rgba.size != (480, 480) or not rgba.getchannel("A").getbbox():
            raise ValueError(f"No NISAR image coverage for {name} on {date}")
        path = OUTPUT / f"nisar-{name}-{date}.webp"
        rgba.save(path, "WEBP", quality=85, method=6)
        print(path.name)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    tasks = [(name, bounds, date) for name, (bounds, dates) in SERIES.items() for date in dates]
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda task: stage(task, args.cache), tasks))
