"""Rebuild the published layers from the NASA GIBS, NASA ARIA and USGS sources."""
import json
import pathlib
import tempfile
from urllib.parse import urlencode
from urllib.request import urlretrieve

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.transform import from_bounds

DATA = pathlib.Path(__file__).resolve().parents[1] / "public/data"
FLOOD_BOUNDS = (32.65, -25.33, 34.20, -24.28)
ICE_BOUNDS = (-104, -75.55, -98, -74.55)
QUAKE_BOUNDS = (-68.8, 9.9, -66.5, 10.85)
ARIA = "https://gis.earthdata.nasa.gov/portal/rest/services/DISASTERS_202606_EARTHQUAKE_VENEZUELA/202611_nisar_LOSDisplacement/ImageServer"
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"


def download(url, path):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        target = pathlib.Path(tmp.name)
    try:
        urlretrieve(url, target)
        target.replace(path)
    finally:
        target.unlink(missing_ok=True)


def get_image(layer, date, bounds, path, cache):
    bbox = transform_bounds("EPSG:4326", "EPSG:3857", *bounds)
    args = dict(SERVICE="WMS", REQUEST="GetMap", VERSION="1.1.1", LAYERS=layer,
                STYLES="", FORMAT="image/png", TRANSPARENT="TRUE", SRS="EPSG:3857",
                BBOX=",".join(map(str, bbox)), WIDTH=1100, HEIGHT=740, TIME=date)
    if cache is None:
        with tempfile.TemporaryDirectory() as tmp:
            target = pathlib.Path(tmp) / "image.png"
            download(GIBS + "?" + urlencode(args), target)
            save_image(target, path)
    else:
        save_image(cache, path)


def save_image(source, target):
    with Image.open(source) as image:
        if image.convert("RGBA").getbbox() is None:
            raise ValueError(f"Empty imagery received for {target.name}")
        image.convert("RGB").save(target, "WEBP", quality=88, method=6)


def make_displacement(source):
    width, height = 640, 272
    bounds = transform_bounds("EPSG:4326", "EPSG:3857", *QUAKE_BOUNDS)
    transform = from_bounds(*bounds, width, height)
    values = np.full((height, width), np.nan, dtype="float32")
    with rasterio.open(source) as raster:
        band = raster.read(1, masked=True).filled(np.nan)
        # The public ImageServer export fills unmapped pixels with zero and omits a nodata tag.
        # Suppress exact zero conservatively because it cannot be distinguished from that fill.
        band[(band == 0) | (abs(band) > 10000)] = np.nan
        reproject(band, values, src_transform=raster.transform, src_crs=raster.crs,
                  dst_transform=transform, dst_crs="EPSG:3857", src_nodata=np.nan,
                  dst_nodata=np.nan, resampling=Resampling.nearest)
    valid = np.isfinite(values)
    if np.count_nonzero(valid) < width:
        raise ValueError("Displacement export has insufficient valid measurements.")
    stops = [[61, 103, 211], [89, 174, 230], [230, 235, 241], [245, 168, 90], [217, 81, 54]]
    rgba = np.zeros((height, width, 4), dtype="uint8")
    for channel in range(3):
        rgba[:, :, channel][valid] = np.interp(values[valid], [-50, -25, 0, 25, 50],
                                                [x[channel] for x in stops])
    rgba[:, :, 3][valid] = 225
    Image.fromarray(rgba).save(DATA / "displacement.webp", "WEBP", lossless=True)
    values[~valid] = np.nan
    values.astype("<f4").tofile(DATA / "displacement.f32")
    stats = {"width": width, "height": height, "bounds": list(bounds),
             "p05": round(float(np.quantile(values[valid], .05)), 1),
             "p95": round(float(np.quantile(values[valid], .95)), 1),
             "valid": int(valid.sum())}
    (DATA / "displacement.json").write_text(json.dumps(stats, separators=(",", ":")))


def make_flood_extent(cache):
    width, height = 550, 415
    bounds = transform_bounds("EPSG:4326", "EPSG:3857", *FLOOD_BOUNDS)
    source_colors = [[50, 210, 245], [255, 255, 0], [250, 30, 36], [175, 175, 175]]
    display_colors = [[87, 185, 240, 240], [240, 209, 95, 240], [255, 121, 87, 245], [165, 171, 178, 92]]
    with tempfile.TemporaryDirectory() as tmp:
        source = cache / "VIIRS_Combined_Flood_3-Day-2026-01-25" if cache else pathlib.Path(tmp) / "flood.png"
        if not cache:
            params = dict(SERVICE="WMS", REQUEST="GetMap", VERSION="1.1.1",
                          LAYERS="VIIRS_Combined_Flood_3-Day", STYLES="",
                          FORMAT="image/png", TRANSPARENT="TRUE", SRS="EPSG:3857",
                          BBOX=",".join(map(str, bounds)), WIDTH=1100, HEIGHT=830, TIME="2026-01-25")
            download(GIBS + "?" + urlencode(params), source)
        with Image.open(source) as image:
            raw = np.array(image.convert("RGBA").resize((width, height), Image.Resampling.NEAREST))
    alpha = raw[:, :, 3] > 0
    classes = np.zeros((height, width), dtype="uint8")
    rgba = np.zeros((height, width, 4), dtype="uint8")
    for i, (input_color, output_color) in enumerate(zip(source_colors, display_colors), 1):
        where = alpha & np.all(raw[:, :, :3] == input_color, axis=2)
        classes[where] = i
        rgba[where] = output_color
    if not np.any(classes == 3):
        raise ValueError("Flood product has no detected flood cells in the selected window.")
    Image.fromarray(rgba).save(DATA / "flood-extent.webp", "WEBP", lossless=True)
    classes.tofile(DATA / "flood-extent.u8")
    (DATA / "flood-extent.json").write_text(json.dumps(
        {"width": width, "height": height, "bounds": list(bounds)}, separators=(",", ":")
    ))


def quake_data(cache):
    features = []
    for i, event in enumerate(("us6000t7zp", "us6000t7zc"), 1):
        if cache:
            path = cache / f"us{i}"
        else:
            path = DATA / f".{event}.json"
            download(f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/{event}.geojson", path)
        raw = json.loads(path.read_text())
        if not cache:
            path.unlink()
        props = {k: raw["properties"][k] for k in ("mag", "place", "time", "url")}
        props["depth"] = raw["geometry"]["coordinates"][2]
        features.append(dict(type="Feature", id=event, geometry=raw["geometry"], properties=props))
        if i == 1:
            if cache:
                path = cache / "shake"
                (DATA / "shaking.json").write_bytes(path.read_bytes())
            else:
                product = raw["properties"]["products"]["shakemap"][0]["contents"]
                download(product["download/cont_mi.json"]["url"], DATA / "shaking.json")
    (DATA / "events.json").write_text(json.dumps(dict(type="FeatureCollection", features=features)))


def main(cache=None):
    DATA.mkdir(exist_ok=True, parents=True)
    sources = [
        ("MODIS_Terra_CorrectedReflectance_Bands721", "2025-12-17", FLOOD_BOUNDS, "flood-reference", "flood-dec"),
        ("MODIS_Terra_CorrectedReflectance_Bands721", "2026-01-25", FLOOD_BOUNDS, "flood-event", "mod-2026-01-25"),
        ("MODIS_Terra_CorrectedReflectance_TrueColor", "2026-02-14", ICE_BOUNDS, "pine-island", "ice-2026-02-14"),
    ]
    for layer, date, bounds, name, key in sources:
        get_image(layer, date, bounds, DATA / f"{name}.webp", cache / key if cache else None)
    with tempfile.TemporaryDirectory() as tmp:
        raster = cache / "aria1" if cache else pathlib.Path(tmp) / "aria.tif"
        if not cache:
            params = dict(bbox=",".join(map(str, QUAKE_BOUNDS)), bboxSR=4326, imageSR=3857,
                          size="930,420", adjustAspectRatio="false", format="tiff", pixelType="F32",
                          renderingRule=json.dumps({"rasterFunction": "None"}),
                          mosaicRule=json.dumps({"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [1]}), f="image")
            download(ARIA + "/exportImage?" + urlencode(params), raster)
        make_displacement(raster)
    quake_data(cache)
    make_flood_extent(cache)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=pathlib.Path)
    main(parser.parse_args().cache)
