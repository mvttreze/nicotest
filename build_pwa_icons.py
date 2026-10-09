"""Draw the Nico robot mark with PIL (no SVG rasterizer available).

Robot: midnight-blue bubble head, white face, dot eyes, smile, side ears,
antenna stubs. 512px master, downscaled derivatives, plus an opaque
maskable variant and an opaque dark variant for Apple/tray.
"""
import pathlib
from PIL import Image, ImageDraw

BLUE = (110, 168, 255, 255)
WHITE = (255, 255, 255, 255)
BG_DARK = (10, 15, 28, 255)


def draw_robot(draw, s):
    """s = scale factor relative to the 512 reference grid."""
    def R(v):
        return int(round(v * s))

    # antenna stubs
    draw.rounded_rectangle([R(42), R(172), R(57), R(250)], radius=R(7), fill=BLUE)
    draw.rounded_rectangle([R(455), R(172), R(470), R(250)], radius=R(7), fill=BLUE)
    # ears
    draw.ellipse([R(18), R(235), R(80), R(360)], fill=BLUE)
    draw.ellipse([R(432), R(235), R(494), R(360)], fill=BLUE)
    # head bubble + speech tail
    draw.ellipse([R(81), R(115), R(431), R(425)], fill=BLUE)
    draw.polygon([(R(196), R(400)), (R(168), R(452)), (R(232), R(424))], fill=BLUE)
    # white face
    draw.rounded_rectangle([R(128), R(168), R(384), R(364)], radius=R(86), fill=WHITE)
    # dot eyes (readable down to 16px; arches would vanish)
    draw.ellipse([R(184), R(232), R(236), R(272)], fill=BLUE)
    draw.ellipse([R(276), R(232), R(328), R(272)], fill=BLUE)
    # smile as a polyline parabola (avoids arc-angle ambiguity)
    pts = [(x, 294 + 14 * (1 - ((x - 256) / 18) ** 2)) for x in range(238, 275, 2)]
    draw.line([(R(x), R(y)) for x, y in pts], fill=BLUE, width=max(1, R(11)), joint="curve")


def robot_layer(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_robot(ImageDraw.Draw(img), size / 512)
    return img


def main():
    out = pathlib.Path(__file__).resolve().parent
    master = robot_layer(512)

    master.save(out / "icon-512.png")
    master.resize((192, 192), Image.LANCZOS).save(out / "icon-192.png")
    master.resize((32, 32), Image.LANCZOS).save(out / "icon-32.png")

    # maskable: opaque full-bleed dark tile, robot at ~72%
    tile = Image.new("RGBA", (512, 512), BG_DARK)
    small = master.resize((368, 368), Image.LANCZOS)
    tile.alpha_composite(small, (72, 72))
    tile.convert("RGB").save(out / "icon-maskable-512.png")

    # opaque dark variant for Apple touch icon / tray / favicon fallback
    dark = Image.new("RGBA", (512, 512), BG_DARK)
    dark.alpha_composite(master, (0, 0))
    dark.convert("RGB").save(out / "icon-180.png".replace("180", "dark-512"))
    dark.resize((180, 180), Image.LANCZOS).save(out / "icon-180.png")
    dark.resize((32, 32), Image.LANCZOS).save(out / "icon-32.png")

    for name in ["icon-512.png", "icon-192.png", "icon-32.png",
                 "icon-maskable-512.png", "icon-180.png", "icon-dark-512.png"]:
        p = out / name
        with Image.open(p) as im:
            print(p.name, im.size, im.mode, p.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
