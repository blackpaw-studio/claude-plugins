#!/usr/bin/env python3
"""Renders a record.sh recording to images with agg (and ffmpeg for crops).

  render.py still <name> <second> <out.png> [--crop x0,y0,x1,y1 (cells)]
      the screen as it stood <second>s into the scripted timeline
  render.py gif <name> <from> <to> <out.gif> [--crop ...] [--speed N]
      the timeline between two seconds, idle stretches capped

Cells, not pixels, for crops: columns x0..x1 and rows y0..y1 (end exclusive).
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT_SIZE = 16
LINE_HEIGHT = 1.4
FONT = "Andale Mono,Menlo,Apple Symbols,STIX Two Math"
# Only the fontdue renderer falls back per glyph across the families. Menlo cannot
# lead under fontdue: it reads Latin-1 through the Mac Roman cmap (· -> ∑).
RENDERER = "fontdue"
# Catppuccin Mocha: bg, fg, then 16 ANSI colours (the house look of rich-statusline's docs).
THEME = ",".join([
    "1e1e2e", "cdd6f4",
    "45475a", "f38ba8", "a6e3a1", "f9e2af", "89b4fa", "f5c2e7", "94e2d5", "bac2de",
    "585b70", "f38ba8", "a6e3a1", "f9e2af", "89b4fa", "f5c2e7", "94e2d5", "a6adc8",
])


def load(name):
    out = HERE / "out" / name
    lines = (out / "session.cast").read_text().splitlines()
    header, events = json.loads(lines[0]), [json.loads(line) for line in lines[1:] if line.strip()]
    markers = {k: float(v) for k, v in (line.split() for line in (out / "markers.txt").read_text().splitlines() if line.strip())}
    # Cast t=0 in wall time: the cast header's timestamp is whole seconds, so
    # anchor on the recorder's start mark against the cast's own clock instead.
    origin = header["timestamp"]
    return header, events, markers["start"] - origin


def segment(header, events, start, end, hold):
    """Cast lines for [start, end] (cast time); earlier output collapsed to t=0."""
    before = "".join(e[2] for e in events if e[1] == "o" and e[0] <= start)
    out = [json.dumps({**header, "timestamp": 0}), json.dumps([0.0, "o", before])]
    out += [json.dumps([round(e[0] - start, 6), "o", e[2]]) for e in events if e[1] == "o" and start < e[0] <= end]
    out.append(json.dumps([round(end - start + hold, 6), "o", ""]))
    return out


def agg(cast_lines, gif, extra=()):
    with tempfile.NamedTemporaryFile("w", suffix=".cast", delete=False) as f:
        f.write("\n".join(cast_lines) + "\n")
    subprocess.run(["agg", "--theme", THEME, "--font-family", FONT, "--renderer", RENDERER,
                    "--font-size", str(FONT_SIZE), "--line-height", str(LINE_HEIGHT), *extra, f.name, str(gif)],
                   check=True, capture_output=True)
    Path(f.name).unlink()


def size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", str(path)], check=True, capture_output=True, text=True).stdout
    w, h = out.strip().split("\n")[0].split(",")
    return int(w), int(h)


def crop_filter(path, header, crop):
    if crop is None:
        return "null"
    x0, y0, x1, y1 = crop
    w, h = size(path)
    cell_w, row_h = w / header["width"], FONT_SIZE * LINE_HEIGHT
    pad_y = (h - header["height"] * row_h) / 2
    pad_x = (w - header["width"] * cell_w) / 2
    left, top = int(pad_x + x0 * cell_w), int(pad_y + y0 * row_h)
    right, bottom = int(pad_x + x1 * cell_w), int(pad_y + y1 * row_h)
    return f"crop={right - left}:{bottom - top}:{left}:{top}"


def still(args):
    header, events, offset = load(args.name)
    t = offset + args.second
    with tempfile.TemporaryDirectory() as tmp:
        gif = Path(tmp) / "still.gif"
        agg(segment(header, events, t, t, 0.2), gif)
        frames = Path(tmp) / "f"
        frames.mkdir()
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(gif), "-fps_mode", "passthrough",
                        str(frames / "%04d.png")], check=True)
        last = sorted(frames.glob("*.png"))[-1]
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(last), "-vf",
                        crop_filter(gif, header, args.crop), args.out], check=True)


def gif(args):
    header, events, offset = load(args.name)
    raw = Path(args.out).with_suffix(".raw.gif")
    agg(segment(header, events, offset + args.start, offset + args.end, 2.0), raw,
        ("--speed", str(args.speed), "--idle-time-limit", "1.2", "--fps-cap", "12", "--last-frame-duration", "2"))
    vf = (f"{crop_filter(raw, header, args.crop)},split[a][b];"
          "[a]palettegen=max_colors=96:stats_mode=full[p];[b][p]paletteuse=dither=none")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), "-filter_complex", vf, args.out], check=True)
    raw.unlink()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    crop = {"type": lambda text: tuple(int(n) for n in text.split(",")), "default": None}
    s = sub.add_parser("still")
    s.add_argument("name"), s.add_argument("second", type=float), s.add_argument("out")
    s.add_argument("--crop", **crop)
    g = sub.add_parser("gif")
    g.add_argument("name"), g.add_argument("start", type=float), g.add_argument("end", type=float), g.add_argument("out")
    g.add_argument("--crop", **crop), g.add_argument("--speed", type=float, default=1.5)
    args = parser.parse_args()
    still(args) if args.cmd == "still" else gif(args)


if __name__ == "__main__":
    main()
