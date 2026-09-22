"""Observable ZIP loader for CENCOOS PICES sea-surface anomaly frames."""

import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import map_coordinates

BASE_URL = "https://www.cencoos.org/images/PICES/"
FILENAME_PATTERN = re.compile(r"noaxis_Anomaly_sst_(\d{8})\.png")
WEST, SOUTH, EAST, NORTH = -129.0, 32.0, -117.0, 42.0


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "MUR-SST-anomaly-map generator"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"Unable to download {url}") from last_error


def reproject_to_web_mercator(png_bytes):
    """Resample an EPSG:4326 PNG onto an EPSG:3857 pixel grid."""
    with Image.open(io.BytesIO(png_bytes)) as source_image:
        source = np.asarray(source_image.convert("RGBA"), dtype=np.float32) / 255
    source_height, source_width = source.shape[:2]

    forward = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    inverse = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    west_meters, south_meters = forward.transform(WEST, SOUTH)
    east_meters, north_meters = forward.transform(EAST, NORTH)
    target_width = source_width
    target_height = round(source_width * (north_meters - south_meters) / (east_meters - west_meters))

    target_y = north_meters - (np.arange(target_height) + 0.5) * (north_meters - south_meters) / target_height
    _, target_latitude = inverse.transform(np.full(target_height, west_meters), target_y)
    source_y = (NORTH - target_latitude) / (NORTH - SOUTH) * source_height - 0.5
    coordinates = np.asarray(
        np.broadcast_arrays(source_y[:, None], np.arange(source_width, dtype=np.float32)[None, :]),
        dtype=np.float32,
    )

    source[:, :, :3] *= source[:, :, 3:4]
    target = np.empty((target_height, target_width, 4), dtype=np.float32)
    for band_index in range(4):
        target[:, :, band_index] = map_coordinates(
            source[:, :, band_index], coordinates, order=1 if band_index < 3 else 0, mode="nearest"
        )
    alpha = target[:, :, 3:4]
    target[:, :, :3] = np.divide(target[:, :, :3], alpha, out=np.zeros_like(target[:, :, :3]), where=alpha > 1e-6)
    output = Image.fromarray(np.clip(np.round(target * 255), 0, 255).astype(np.uint8), "RGBA")
    encoded = io.BytesIO()
    output.save(encoded, format="PNG", compress_level=6)
    return encoded.getvalue(), target_width, target_height


def build_archive():
    index_html = fetch_bytes(BASE_URL).decode("utf-8", errors="replace")
    dates = sorted(set(FILENAME_PATTERN.findall(index_html)))
    if not dates:
        raise RuntimeError(f"No PICES frames found at {BASE_URL}")

    manifest_frames = []
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for index, date in enumerate(dates, start=1):
            filename = f"noaxis_Anomaly_sst_{date}.png"
            print(f"[{index}/{len(dates)}] {filename}", file=sys.stderr, flush=True)
            transformed_png, width, height = reproject_to_web_mercator(fetch_bytes(f"{BASE_URL}{filename}"))
            iso_date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
            frame_path = f"frames/{iso_date}.png"
            archive.writestr(frame_path, transformed_png)
            manifest_frames.append({"date": iso_date, "path": frame_path, "width": width, "height": height})

        archive.writestr("manifest.json", json.dumps({
            "version": 1,
            "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "source": BASE_URL,
            "frame_crs": "EPSG:3857",
            "reprojected": True,
            "bounds": {"west": WEST, "south": SOUTH, "east": EAST, "north": NORTH},
            "frames": manifest_frames,
        }, separators=(",", ":")))
    return buffer.getvalue()


# Observable requires the loader's stdout to contain only the attachment bytes.
sys.stdout.buffer.write(build_archive())
