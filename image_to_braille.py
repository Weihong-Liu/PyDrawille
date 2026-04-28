"""
将任意图片转换为终端盲文点阵图,支持 rich 渐变着色。

用法:
    uv run python image_to_braille.py <图片路径> [--cols N] [--mode subpixel|density]
                                                 [--no-invert] [--threshold N]
                                                 [--colors C1,C2,...] [--render]
                                                 [--out FILE]

模式:
    subpixel  默认。每个盲文字符代表 2x4 子像素位图,精度最高。
    density   按 popcount 0..8 取 9 个字符当亮度阶,1 字 1 像素。

颜色渐变:
    --colors '#CD7F32,#FFBF00,#FFD700,#B8860B'
        把这些 hex 颜色按行均匀插值,每行用 [#XXXXXX]...[/] rich 标签包裹。
    --render
        直接通过 rich.Console 渲染到终端(否则只输出带标签的文本)。
"""

import argparse
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from PIL import Image, ImageOps

from PyDrawille import CanvasSurface

DENSITY_RAMP = "⠀⢀⢠⢰⢸⣸⣼⣾⣿"

GRADIENT_PRESETS = {
    "bronze": ["#CD7F32", "#FFBF00", "#FFD700", "#FFBF00", "#CD7F32", "#B8860B"],
    "fire": ["#3B0000", "#9F1B0F", "#F26522", "#FFD23F", "#FFF8C6"],
    "ocean": ["#001F3F", "#0074D9", "#39CCCC", "#7FDBFF"],
    "mono": ["#FFFFFF"],
}


def image_to_canvas(
    img_path: Path,
    cols: int = 80,
    invert: bool = True,
    threshold: Optional[int] = None,
) -> CanvasSurface:
    img = Image.open(img_path).convert("L")
    if invert:
        img = ImageOps.invert(img)

    src_w, src_h = img.size
    canvas_w = cols * 2
    canvas_h = round(canvas_w * src_h / src_w / 4) * 4
    if canvas_h < 4:
        canvas_h = 4

    img = img.resize((canvas_w, canvas_h), Image.LANCZOS)
    if threshold is None:
        bw = img.convert("1")
    else:
        bw = img.point(lambda p: 255 if p > threshold else 0, mode="1")

    arr = np.array(bw, dtype=np.bool_).T
    canvas = CanvasSurface(width=canvas_w, height=canvas_h)
    canvas.data = arr
    return canvas


def image_to_density(img_path: Path, cols: int = 80, invert: bool = True) -> str:
    img = Image.open(img_path).convert("L")
    if invert:
        img = ImageOps.invert(img)

    src_w, src_h = img.size
    rows = max(1, round(cols * src_h / src_w / 2))
    img = img.resize((cols, rows), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.int32)
    levels = np.clip(arr * len(DENSITY_RAMP) // 256, 0, len(DENSITY_RAMP) - 1)
    return "\n".join("".join(DENSITY_RAMP[v] for v in row) for row in levels)


def hex_to_rgb(s: str) -> Tuple[int, int, int]:
    s = s.lstrip("#")
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def interpolate_colors(
    stops: List[Tuple[int, int, int]], n: int
) -> List[Tuple[int, int, int]]:
    if not stops:
        return []
    if len(stops) == 1 or n == 1:
        return [stops[0]] * n
    out = []
    for i in range(n):
        t = i * (len(stops) - 1) / (n - 1)
        lo = int(t)
        hi = min(lo + 1, len(stops) - 1)
        f = t - lo
        c1, c2 = stops[lo], stops[hi]
        out.append(
            (
                round(c1[0] * (1 - f) + c2[0] * f),
                round(c1[1] * (1 - f) + c2[1] * f),
                round(c1[2] * (1 - f) + c2[2] * f),
            )
        )
    return out


def colorize(text: str, colors_arg: str) -> str:
    """按行给文本套上 [#hex]...[/] 渐变。colors_arg 可以是预设名或逗号分隔 hex 列表。"""
    if colors_arg in GRADIENT_PRESETS:
        raw = GRADIENT_PRESETS[colors_arg]
    else:
        raw = [c.strip() for c in colors_arg.split(",") if c.strip()]
    stops = [hex_to_rgb(c) for c in raw]

    lines = text.split("\n")
    colors = interpolate_colors(stops, len(lines))
    return "\n".join(
        f"[#{r:02X}{g:02X}{b:02X}]{line}[/]"
        for line, (r, g, b) in zip(lines, colors)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="图片 → 盲文终端点阵图")
    parser.add_argument("image", type=Path)
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument(
        "--mode", choices=("subpixel", "density"), default="subpixel"
    )
    parser.add_argument("--no-invert", action="store_true")
    parser.add_argument("--threshold", type=int, default=None)
    parser.add_argument(
        "--colors",
        default=None,
        help="预设名(bronze/fire/ocean/mono)或 '#hex1,#hex2,...' 渐变",
    )
    parser.add_argument(
        "--render",
        action="store_true",
        help="用 rich.Console 渲染带色文本到终端",
    )
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    if args.mode == "density":
        text = image_to_density(
            args.image, cols=args.cols, invert=not args.no_invert
        )
    else:
        canvas = image_to_canvas(
            args.image,
            cols=args.cols,
            invert=not args.no_invert,
            threshold=args.threshold,
        )
        text = canvas.dump()

    if args.colors:
        text = colorize(text, args.colors)

    if args.render:
        from rich.console import Console

        Console().print(text, highlight=False)
    else:
        print(text)

    if args.out:
        args.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
