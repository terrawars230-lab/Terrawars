#!/usr/bin/env python3
"""
Renders every raster icon TerraWars ships, from one definition of the mark.

    python scripts/generate-icons.py

Outputs:
  ios/TerraWars/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png
      The App Store icon. Opaque RGB: App Store Connect rejects an icon with an
      alpha channel. Xcode derives every other size from it.
  android/app/src/main/res/mipmap-*/ic_launcher(.png|_round.png)
      Legacy fallbacks. minSdk is 26, so devices use the adaptive icon in
      mipmap-anydpi-v26; these exist so nothing in the APK is still the
      template's Android robot.
  docs/store/assets/play-store-icon-512.png
      The 512 x 512 hi-res icon Play Console asks for.
  docs/store/assets/play-feature-graphic-1024x500.png
      The feature graphic Play Console asks for. A placeholder in the brand
      style — replace it with designed artwork when you have it.

The geometry is the same 108-unit canvas as the Android vector drawable
android/app/src/main/res/drawable/ic_launcher_foreground.xml. Change both
together. Needs only numpy (no Pillow): shapes are drawn as signed distance
fields, which gives anti-aliased edges for free, and PNGs are written with the
standard library.
"""

import os
import struct
import zlib

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

BACKGROUND = "#161826"
TERRITORY_FILL = "#423A6A"
TERRITORY_STROKE = "#9184D9"
PIN = "#D2CEFD"

# Territory colours (src/core/theme/tokens.ts), for the feature graphic.
TERRITORY_PALETTE = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#EC4899", "#14B8A6"]

# The mark, in the 108-unit adaptive-icon canvas.
TERRITORY = [(31, 62), (44, 41), (70, 43), (80, 64), (56, 79)]
TERRITORY_STROKE_WIDTH = 3.0
PIN_CENTRE = (54.0, 47.0)
PIN_RADIUS = 15.0
PIN_TIP = (54.0, 76.0)
PIN_HOLE_RADIUS = 6.0


def hex_rgb(value):
    value = value.lstrip("#")
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


# ── Signed distance fields ────────────────────────────────────────────────


def sd_circle(x, y, centre, radius):
    return np.hypot(x - centre[0], y - centre[1]) - radius


def sd_polygon(x, y, vertices):
    """Exact signed distance to a simple polygon (negative inside)."""
    v = np.asarray(vertices, dtype=np.float64)
    distance = np.full(x.shape, np.inf)
    inside = np.zeros(x.shape, dtype=bool)
    count = len(v)
    for i in range(count):
        ax, ay = v[i]
        bx, by = v[(i + 1) % count]
        ex, ey = bx - ax, by - ay
        wx, wy = x - ax, y - ay
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        distance = np.minimum(distance, np.hypot(wx - ex * t, wy - ey * t))
        crosses = (ay > y) != (by > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            x_at = ax + (y - ay) * ex / (by - ay)
        inside ^= crosses & (x < x_at)
    return np.where(inside, -distance, distance)


def sd_pin(x, y):
    """The map pin: a circle joined to a tangent cone, minus the centre hole."""
    cx, cy = PIN_CENTRE
    tx, ty = PIN_TIP
    d = np.hypot(tx - cx, ty - cy)
    # Where the tangents from the tip meet the circle.
    phi = np.arccos(PIN_RADIUS / d)
    left = (cx - PIN_RADIUS * np.sin(phi), cy + PIN_RADIUS * np.cos(phi))
    right = (cx + PIN_RADIUS * np.sin(phi), cy + PIN_RADIUS * np.cos(phi))
    cone = sd_polygon(x, y, [PIN_TIP, left, PIN_CENTRE, right])
    body = np.minimum(sd_circle(x, y, PIN_CENTRE, PIN_RADIUS), cone)
    return np.maximum(body, -sd_circle(x, y, PIN_CENTRE, PIN_HOLE_RADIUS))


def coverage(sd_pixels):
    return np.clip(0.5 - sd_pixels, 0.0, 1.0)[..., None]


def paint(canvas, sd_pixels, colour):
    alpha = coverage(sd_pixels)
    canvas[:] = canvas * (1 - alpha) + hex_rgb(colour) * alpha


# ── Rendering ─────────────────────────────────────────────────────────────


def paint_mark(canvas, x, y, scale):
    """Paints the mark onto `canvas`, where (x, y) are 108-unit coordinates per pixel."""
    territory = sd_polygon(x, y, TERRITORY) * scale
    paint(canvas, territory, TERRITORY_FILL)
    paint(canvas, np.abs(territory) - TERRITORY_STROKE_WIDTH * scale / 2, TERRITORY_STROKE)
    paint(canvas, sd_pin(x, y) * scale, PIN)


def render_mark(size, view_min, view_max, mask=None):
    """
    Renders the icon at `size` px, showing the canvas window [view_min, view_max]
    (in 108-unit coordinates). Returns (rgb float array, alpha float array).
    """
    scale = size / (view_max - view_min)
    pixel = np.arange(size) + 0.5
    x, y = np.meshgrid(pixel / scale + view_min, pixel / scale + view_min)

    canvas = np.zeros((size, size, 3))
    canvas[:] = hex_rgb(BACKGROUND)
    paint_mark(canvas, x, y, scale)

    alpha = np.ones((size, size))
    if mask == "circle":
        centre = size / 2
        sd = np.hypot(pixel[None, :] - centre, pixel[:, None] - centre) - size / 2
        alpha = np.clip(0.5 - sd, 0, 1)
    elif mask == "rounded":
        radius = size * 0.18
        half = size / 2 - radius
        qx = np.abs(pixel[None, :] - size / 2) - half
        qy = np.abs(pixel[:, None] - size / 2) - half
        sd = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - radius
        alpha = np.clip(0.5 - sd, 0, 1)
    return canvas, alpha


def render_feature_graphic(width, height):
    pixel_x = np.arange(width) + 0.5
    pixel_y = np.arange(height) + 0.5
    x, y = np.meshgrid(pixel_x, pixel_y)
    canvas = np.zeros((height, width, 3))
    canvas[:] = hex_rgb(BACKGROUND)

    # Rival territories on either side of the mark, faint so they read as map.
    rng = np.random.default_rng(20260922)
    centres = [
        (110, 120), (250, 330), (95, 410), (330, 90),
        (930, 110), (790, 360), (925, 400), (700, 70),
    ]
    for index, (cx, cy) in enumerate(centres):
        radius = rng.uniform(55, 85)
        sides = int(rng.integers(5, 7))
        angles = np.linspace(0, 2 * np.pi, sides, endpoint=False) + rng.uniform(0, 1)
        vertices = [
            (cx + np.cos(a) * radius * rng.uniform(0.85, 1.0), cy + np.sin(a) * radius * rng.uniform(0.85, 1.0))
            for a in angles
        ]
        colour = TERRITORY_PALETTE[index % len(TERRITORY_PALETTE)]
        sd = sd_polygon(x, y, vertices)
        fill = coverage(sd) * 0.22
        canvas[:] = canvas * (1 - fill) + hex_rgb(colour) * fill
        edge = coverage(np.abs(sd) - 1.25) * 0.6
        canvas[:] = canvas * (1 - edge) + hex_rgb(colour) * edge

    # The mark, centred, painted straight onto the scene.
    mark_px = 330
    view_min, view_max = 22, 86
    scale = mark_px / (view_max - view_min)
    left = (width - mark_px) / 2
    top = (height - mark_px) / 2
    paint_mark(canvas, (x - left) / scale + view_min, (y - top) / scale + view_min, scale)
    return canvas


# ── PNG writing (stdlib only) ─────────────────────────────────────────────


def write_png(path, rgb, alpha=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    height, width, _ = rgb.shape
    data = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)
    if alpha is not None:
        a = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)[..., None]
        data = np.concatenate([data, a], axis=2)
        colour_type, channels = 6, 4
    else:
        colour_type, channels = 2, 3
    raw = b"".join(b"\x00" + data[row].tobytes() for row in range(height))

    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, colour_type, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)
    print(f"  wrote {os.path.relpath(path, ROOT)} ({width}x{height}, {channels} channels)")


def main():
    print("Rendering TerraWars icons")

    # iOS: opaque, full-bleed square; iOS applies its own corner mask.
    ios, _ = render_mark(1024, 12, 96)
    write_png(os.path.join(ROOT, "ios/TerraWars/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png"), ios)

    # Play Console hi-res icon: 512 x 512, full square (Play masks it itself).
    play, _ = render_mark(512, 12, 96)
    write_png(os.path.join(ROOT, "docs/store/assets/play-store-icon-512.png"), play)

    # Android legacy fallbacks: the adaptive icon's visible 72-unit window.
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        folder = os.path.join(ROOT, f"android/app/src/main/res/mipmap-{density}")
        rgb, alpha = render_mark(size, 18, 90, mask="rounded")
        write_png(os.path.join(folder, "ic_launcher.png"), rgb, alpha)
        rgb, alpha = render_mark(size, 18, 90, mask="circle")
        write_png(os.path.join(folder, "ic_launcher_round.png"), rgb, alpha)

    # Play feature graphic: 1024 x 500, no alpha.
    feature = render_feature_graphic(1024, 500)
    write_png(os.path.join(ROOT, "docs/store/assets/play-feature-graphic-1024x500.png"), feature)


if __name__ == "__main__":
    main()
