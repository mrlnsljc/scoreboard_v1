#!/usr/bin/env python3
"""
Dependency-free PNG icon generator for the Scoreboard PWA.

We have no PIL / cairosvg / rsvg on this machine, so we draw the icon by hand
into an RGBA pixel buffer and encode a PNG using only the stdlib (zlib + struct).
Supersampled 3x then box-downsampled for smooth anti-aliased edges.

Design: dark app-shell background + an accent-green "live" ring with a solid
centre dot (evokes a live-scores indicator). Maskable variant is full-bleed.

Run:  python3 generate_icons.py
"""
import struct, zlib, math

# ---- palette (matches css --bg / --accent) -------------------------------
BG        = (13, 17, 23)      # #0d1117  app shell dark
BG_MASK_A = (16, 24, 33)      # subtle vertical gradient top
BG_MASK_B = (9, 13, 18)       # subtle vertical gradient bottom
ACCENT    = (34, 197, 94)     # #22c55e  green
ACCENT_HI = (74, 222, 128)    # lighter green for gradient
DOT       = (240, 246, 252)   # near-white centre dot


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size, maskable=False):
    """Render at 3x supersample, then downsample to `size`. Returns RGBA bytes rows."""
    ss = 3
    S = size * ss
    buf = bytearray(S * S * 4)

    cx = cy = S / 2.0
    # geometry: ring radius + thickness relative to canvas
    ring_r = S * (0.30 if maskable else 0.32)
    ring_w = S * 0.085
    dot_r = S * (0.135 if maskable else 0.145)

    def put(x, y, rgb, a=1.0):
        i = (y * S + x) * 4
        if a >= 1.0:
            buf[i:i+4] = bytes((rgb[0], rgb[1], rgb[2], 255))
        else:
            # alpha-over onto existing
            br, bg, bb, ba = buf[i], buf[i+1], buf[i+2], buf[i+3]
            na = a + (ba / 255.0) * (1 - a)
            if na <= 0:
                return
            out = []
            for k in range(3):
                src = rgb[k]
                dst = (br, bg, bb)[k]
                out.append(round((src * a + dst * (ba / 255.0) * (1 - a)) / na))
            buf[i:i+4] = bytes((out[0], out[1], out[2], round(na * 255)))

    for y in range(S):
        for x in range(S):
            px, py = x + 0.5, y + 0.5
            # ---- background ----
            if maskable:
                # full-bleed vertical gradient so the icon survives circular masks
                t = y / S
                put(x, y, lerp(BG_MASK_A, BG_MASK_B, t), 1.0)
            else:
                # rounded-square app tile with transparent corners
                r = S * 0.22  # corner radius
                inset = 0
                # distance to rounded-rect edge for AA
                dx = max(inset - px, px - (S - inset), 0)
                dy = max(inset - py, py - (S - inset), 0)
                # signed distance for rounded corners
                qx = abs(px - cx) - (S / 2 - r)
                qy = abs(py - cy) - (S / 2 - r)
                outside = math.hypot(max(qx, 0), max(qy, 0)) - r
                if outside <= 0:
                    cov = 1.0
                elif outside < ss:
                    cov = max(0.0, 1.0 - outside / ss)
                else:
                    cov = 0.0
                if cov > 0:
                    put(x, y, BG, cov)
                else:
                    continue

            # ---- accent ring (with vertical gradient) ----
            d = math.hypot(px - cx, py - cy)
            ring_edge = abs(d - ring_r)
            half = ring_w / 2.0
            cov = 0.0
            if ring_edge <= half:
                cov = 1.0
            elif ring_edge < half + ss:
                cov = max(0.0, 1.0 - (ring_edge - half) / ss)
            if cov > 0:
                t = (py - (cy - ring_r)) / (2 * ring_r)
                t = min(1.0, max(0.0, t))
                put(x, y, lerp(ACCENT_HI, ACCENT, t), cov)

            # ---- centre dot ----
            dd = d - dot_r
            cov2 = 0.0
            if dd <= 0:
                cov2 = 1.0
            elif dd < ss:
                cov2 = max(0.0, 1.0 - dd / ss)
            if cov2 > 0:
                put(x, y, DOT, cov2)

    # ---- box downsample ss x ss ----
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for j in range(ss):
                for i in range(ss):
                    sx, sy = x * ss + i, y * ss + j
                    idx = (sy * S + sx) * 4
                    r += buf[idx]; g += buf[idx+1]; b += buf[idx+2]; a += buf[idx+3]
            n = ss * ss
            o = (y * size + x) * 4
            out[o] = r // n; out[o+1] = g // n; out[o+2] = b // n; out[o+3] = a // n
    return out


def write_png(path, size, rgba):
    """Encode an RGBA pixel buffer as a PNG (stdlib only)."""
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return c

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, size, "x", size)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    write_png(os.path.join(here, "icon-512.png"), 512, render(512, maskable=False))
    write_png(os.path.join(here, "icon-192.png"), 192, render(192, maskable=False))
    write_png(os.path.join(here, "icon-maskable-512.png"), 512, render(512, maskable=True))
    write_png(os.path.join(here, "icon-180.png"), 180, render(180, maskable=False))  # apple-touch
    print("done")
