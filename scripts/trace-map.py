"""Build-time tracing of the user-supplied artwork; no raster ships in the app.

Usage: python scripts/trace-map.py reference.png
Requires Pillow, numpy, vtracer (development tools only).
Coordinates below refer to the 1778 x 1408 preview of the 3780 x 2992 source.
"""

import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import vtracer
from PIL import Image

source = Image.open(sys.argv[1]).convert("RGB")
pixels = np.asarray(source).astype(np.int16)
height, width = pixels.shape[:2]
sx, sy = width / 1778, height / 1408

# The diagram's actual tram inks. Rail, river, branding and label inks are omitted.
palette = [
    (255, 152, 0), (242, 174, 108), (255, 203, 0), (165, 232, 254),
    (45, 208, 231), (13, 179, 144), (245, 41, 183), (54, 74, 116),
    (149, 30, 174), (175, 100, 56), (57, 155, 206), (212, 195, 113),
    (235, 53, 61), (58, 190, 42), (40, 188, 146), (161, 37, 38),
    (171, 211, 157), (20, 112, 224), (206, 223, 86), (173, 207, 215),
    (255, 106, 70), (51, 188, 26),
]
keep = np.ones((height, width), dtype=bool)


def remove(x1, y1, x2, y2):
    keep[round(y1 * sy):round(y2 * sy), round(x1 * sx):round(x2 * sx)] = False


def remove_disc(x, y, radius=8.5):
    yy, xx = np.ogrid[:height, :width]
    keep[((xx / sx - x) ** 2 + (yy / sy - y) ** 2) < radius ** 2] = False


# Crop the framing/legends and remove route-number discs and non-network notes.
for rect in [
    (0, 0, 1778, 108), (0, 0, 155, 1408), (0, 1282, 1778, 1408),
    (1670, 0, 1778, 1408), (1148, 783, 1670, 1310),
    (1180, 692, 1534, 780),
    (674, 107, 716, 128), (398, 210, 457, 237),
    (548, 359, 591, 383), (151, 368, 179, 424), (241, 382, 267, 424),
    (202, 630, 230, 670), (199, 753, 231, 791),
    (776, 329, 798, 351), (939, 258, 983, 308), (1122, 193, 1159, 221),
    (1399, 192, 1456, 221), (1578, 461, 1637, 488), (1540, 484, 1562, 506),
    (1553, 726, 1587, 770), (998, 560, 1025, 584),
    (1001, 1060, 1026, 1118), (986, 1230, 1032, 1276),
    (479, 1226, 504, 1282), (978, 322, 986, 479),
    (155, 297, 454, 309), (498, 297, 655, 310),
    (701, 463, 729, 483), (826, 817, 849, 840), (720, 1027, 800, 1040),
]:
    remove(*rect)
for x, y in [(193, 1232), (183, 1244), (194, 1257), (208, 1244),
             (158, 1085), (170, 1073), (183, 1085), (170, 1098)]:
    remove_disc(x, y)

# Assign antialiased pixels to their closest foreground ink. The distance cutoff
# excludes background and text while keeping the original lane/stop silhouettes.
distance = np.full((height, width), 100000, dtype=np.float32)
nearest = np.zeros((height, width), dtype=np.uint8)
background = np.array([36, 31, 49], dtype=np.float32)
relative = pixels.astype(np.float32) - background
excluded = [(246, 97, 81), (89, 77, 122), (39, 196, 255), (97, 160, 234), (255, 255, 255), (61, 56, 70)]
for index, color in enumerate(palette + excluded):
    vector = np.array(color, dtype=np.float32) - background
    coverage = np.clip((relative * vector).sum(axis=2) / (vector * vector).sum(), 0.30, 1)
    delta = relative - coverage[:, :, None] * vector
    candidate = (delta * delta).sum(axis=2)
    better = candidate < distance
    nearest[better] = index
    distance[better] = candidate[better]

svg = ET.Element("svg", {
    "xmlns": "http://www.w3.org/2000/svg", "viewBox": "0 0 1778 1408",
    "fill-rule": "evenodd", "aria-hidden": "true",
})
ET.SubElement(svg, "title").text = "Kraków tram network — traced from the supplied reference"
with tempfile.TemporaryDirectory(prefix="tram-trace-") as temp:
    for index, color in enumerate(palette):
        mask = keep & (nearest == index) & (distance < 10 ** 2)
        # vtracer binary traces black objects on white.
        bitmap = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8))
        png, vector = Path(temp) / "ink.png", Path(temp) / "ink.svg"
        bitmap.save(png)
        vtracer.convert_image_to_svg_py(
            str(png), str(vector), colormode="binary", mode="spline",
            filter_speckle=8, corner_threshold=60, length_threshold=2,
            max_iterations=10, splice_threshold=45, path_precision=2,
        )
        group = ET.SubElement(svg, "g", {
            "fill": "#%02x%02x%02x" % color,
            "transform": f"scale({1 / sx:.9f} {1 / sy:.9f})",
        })
        for path in ET.parse(vector).getroot():
            if path.tag.endswith("path"):
                attributes = {key: value for key, value in path.attrib.items() if key != "fill"}
                ET.SubElement(group, "path", attributes)

# Transfer-station outlines are white in the source and must be reconstructed
# separately from the colored tram inks. These are stops, not rail annotations.
interchanges = ET.SubElement(svg, "g", {
    "fill": "none", "stroke": "#e4e0e8", "stroke-width": "1.5",
})
for x, y, w, h, angle in [
    (520, 319, 30, 51, 0), (528, 504, 15, 47, 0),
    (609, 504, 38, 51, 0), (444, 535, 42, 43, 45),
    (441, 677, 43, 22, -45), (585, 674, 30, 43, 45),
    (660, 748, 30, 44, 45), (535, 838, 47, 36, 0),
    (543, 949, 37, 37, 0), (684, 949, 37, 37, 0),
    (335, 1023, 45, 37, 0), (272, 1131, 30, 43, 45),
    (875, 1023, 37, 37, 0), (668, 1200, 52, 31, 0),
    (854, 504, 52, 51, 0), (854, 689, 52, 37, 0),
    (1194, 504, 46, 45, 0), (1245, 401, 44, 49, 45),
    (1357, 496, 31, 44, 0), (1551, 400, 29, 29, 0),
]:
    attrs = {"x": str(x), "y": str(y), "width": str(w), "height": str(h), "rx": "3"}
    if angle:
        attrs["transform"] = f"rotate({angle} {x + w / 2} {y + h / 2})"
    ET.SubElement(interchanges, "rect", attrs)

output = Path(__file__).resolve().parents[1] / "public" / "tram-network.svg"
ET.indent(svg)
ET.ElementTree(svg).write(output, encoding="unicode")
print(f"Traced {sum(1 for element in svg.iter() if element.tag == 'path')} paths to {output}")
