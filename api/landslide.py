"""TerraPulse landslide candidate inference for Vercel and local HTTP."""
from functools import lru_cache
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from math import exp, isfinite
from pathlib import Path
from struct import Struct
from urllib.parse import parse_qs, urlsplit

DATA = Path(__file__).resolve().parents[1] / "server_data"
MAX_PIXELS = 128 * 128
MAX_BYTES = 4_000_000
FLOAT32 = Struct("f")


def float32(value):
    return FLOAT32.unpack(FLOAT32.pack(value))[0]


def read_asset(name):
    with gzip.open(DATA / name, "rt", encoding="utf-8") as asset:
        return json.load(asset)


@lru_cache(maxsize=1)
def load_model():
    model = read_asset("landslide_model.json.gz")
    compiled = []
    for left, right, features, splits, default in model["trees"]:
        compiled.append(tuple(
            (feature, float32(split), lchild, rchild, dleft)
            for lchild, rchild, feature, split, dleft in zip(left, right, features, splits, default)
        ))
    return model["card"], model["base_margin"], tuple(compiled)


def parse_tile(payload):
    if not isinstance(payload, dict):
        raise ValueError("Expected a JSON object with width, height and rows.")
    width, height, rows = (payload.get(key) for key in ("width", "height", "rows"))
    if type(width) is not int or type(height) is not int or not (1 <= width <= 128 and 1 <= height <= 128):
        raise ValueError("Width and height must be integers from 1 to 128.")
    if not isinstance(rows, list) or len(rows) != width * height:
        raise ValueError("Supply one row per pixel, ordered left to right and top to bottom.")
    clean = []
    for row in rows:
        if not isinstance(row, list) or len(row) != 14:
            raise ValueError("Each pixel requires all 14 Landslide4Sense channels.")
        values = []
        for value in row:
            if value is None:
                values.append(None)
                continue
            if type(value) not in (int, float) or not isfinite(value) or abs(value) > 3.4e38:
                raise ValueError("Band values must be finite float32 numbers or null.")
            values.append(float32(value))
        clean.append(values)
    return width, height, clean


def predict(rows):
    _, base, trees = load_model()
    scores = []
    for row in rows:
        if all(value is None for value in row):
            scores.append(None)
            continue
        margin = base
        for tree in trees:
            index = 0
            while True:
                band, split, left, right, default_left = tree[index]
                if left == -1:
                    margin = float32(margin + split)
                    break
                value = row[band]
                use_left = default_left if value is None else value < split
                index = left if use_left else right
        scores.append(float32(1 / (1 + exp(-margin))))
    return scores


def result(payload):
    width, height, rows = parse_tile(payload)
    card, _, _ = load_model()
    threshold = card["threshold"]
    scores = predict(rows)
    return {
        "width": width, "height": height, "threshold": threshold, "scores": scores,
        "candidate_pixels": sum(score is not None and score >= threshold for score in scores),
        "valid_pixels": sum(score is not None for score in scores),
        "model_revision": card["revision"],
    }


@lru_cache(maxsize=1)
def example_result():
    example = read_asset("landslide_example.json.gz")
    return result(example) | {key: example[key] for key in ("id", "rgb", "labels")}


class handler(BaseHTTPRequestHandler):
    def send_json(self, body, status=200, cache="no-store"):
        content = json.dumps(body, separators=(",", ":"), allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        query = parse_qs(urlsplit(self.path).query)
        body = example_result() if query.get("example") == ["1"] else load_model()[0]
        self.send_json(body, cache="public, max-age=300, s-maxage=3600")

    def do_POST(self):
        if self.headers.get_content_type() != "application/json":
            self.send_json({"error": "Use Content-Type application/json."}, 415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_BYTES:
                self.send_json({"error": "JSON request must be between 1 byte and 4 MB."}, 413)
                return
            payload = json.loads(self.rfile.read(length))
            answer = result(payload)
        except (ValueError, OverflowError) as error:
            self.send_json({"error": str(error)}, 400)
            return
        self.send_json(answer)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8765), handler).serve_forever()
