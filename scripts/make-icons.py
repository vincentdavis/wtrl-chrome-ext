#!/usr/bin/env python3
"""Generate the extension icon set.

Pure stdlib (zlib + struct) so the repo needs no image dependencies. Renders at
4x and box-downsamples for antialiasing.
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "icons")

BG = (0x14, 0x17, 0x1C)
FG = (0xE6, 0x39, 0x46)
SS = 4  # supersampling factor

# "W" polyline in unit space, plus stroke half-width.
W_POINTS = [(0.00, 0.00), (0.22, 1.00), (0.50, 0.40), (0.78, 1.00), (1.00, 0.00)]
GLYPH_BOX = (0.21, 0.29, 0.79, 0.71)  # x0, y0, x1, y1 within the icon
STROKE = 0.085  # half-width, in icon-width units


def point_segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def render(size):
    big = size * SS
    x0, y0, x1, y1 = GLYPH_BOX
    gx, gy = x0 * big, y0 * big
    gw, gh = (x1 - x0) * big, (y1 - y0) * big

    segments = []
    for i in range(len(W_POINTS) - 1):
        ax, ay = W_POINTS[i]
        bx, by = W_POINTS[i + 1]
        segments.append((gx + ax * gw, gy + ay * gh, gx + bx * gw, gy + by * gh))

    radius = big * 0.22
    stroke_px = STROKE * big
    pixels = bytearray(big * big * 4)

    for y in range(big):
        py = y + 0.5
        row = y * big * 4
        for x in range(big):
            px = x + 0.5

            # Rounded-rect mask.
            cx = min(max(px, radius), big - radius)
            cy = min(max(py, radius), big - radius)
            if (px - cx) ** 2 + (py - cy) ** 2 > radius * radius:
                continue  # outside -> transparent

            inside_glyph = any(
                point_segment_distance(px, py, *seg) <= stroke_px for seg in segments
            )
            r, g, b = FG if inside_glyph else BG
            offset = row + x * 4
            pixels[offset] = r
            pixels[offset + 1] = g
            pixels[offset + 2] = b
            pixels[offset + 3] = 255

    # Box downsample SS x SS -> 1.
    out = bytearray(size * size * 4)
    area = SS * SS
    for y in range(size):
        for x in range(size):
            rs = gs = bs = as_ = 0
            for sy in range(SS):
                base = ((y * SS + sy) * big + x * SS) * 4
                for sx in range(SS):
                    o = base + sx * 4
                    a = pixels[o + 3]
                    rs += pixels[o] * a
                    gs += pixels[o + 1] * a
                    bs += pixels[o + 2] * a
                    as_ += a
            o = (y * size + x) * 4
            if as_:
                out[o] = rs // as_
                out[o + 1] = gs // as_
                out[o + 2] = bs // as_
            out[o + 3] = as_ // area
    return bytes(out)


def write_png(path, size, rgba):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    stride = size * 4
    raw = b"".join(b"\x00" + rgba[y * stride:(y + 1) * stride] for y in range(size))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, size, render(size))
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
