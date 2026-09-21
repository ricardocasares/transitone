"""Build-time tracing of the user-supplied artwork; no raster ships in the app.

Usage: python scripts/trace-map.py reference.png
Requires Pillow, numpy, vtracer (development tools only).
Coordinates below refer to the 1778 x 1408 preview of the 3780 x 2992 source.
"""

import re
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
# The orange-red route has a darker core near Krowodrza Górka. Match both
# sampled shades to the same output ink; otherwise only its thin edges survive.
ink_samples = list(enumerate(palette + excluded)) + [
    (palette.index((255, 106, 70)), (254, 97, 62)),
]
for index, color in ink_samples:
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
# Hollow tunnel strokes are too thin to trace cleanly. Their isolated raster
# contours are replaced below with centerlines measured from the reference.
# (ink, contour bounds, solid approach, tunnel centerline, solid exit).
# The outer stroke spans all three parts; only the tunnel gets a center gap.
# Stop circles still come from the trace.
tunnels = [
    ("#ff9800", (550, 320, 895, 504), "M549.5 326 H610 Q646.468 326 646.468 362", "M646.468 376.5 V408 C646.468 422.256 646.468 422.256 661 422.256 H860 Q890.9 422.256 890.9 453.1 V468.5", "V504.5"),
    ("#ff6a46", (550, 320, 895, 504), "M549.5 333.5 H610 Q639.088 333.5 639.088 362", "M639.088 376.5 V408 C639.088 429.894 639.088 429.894 661 429.894 H860 Q883.4 429.894 883.4 453.1 V468.5", "V504.5"),
    ("#af6438", (550, 320, 895, 504), "M549.5 341 H610 Q631.571 341 631.571 362", "M631.571 376.5 V408 C631.571 437.428 631.571 437.428 661 437.428 H860 Q876.1 437.428 876.1 453.1 V468.5", "V504.5"),
    ("#364a74", (550, 320, 895, 504), "M549.5 355.8 H608 Q616.804 355.8 616.804 366", "M616.804 376.5 V408 C616.804 444.706 616.804 444.706 654 444.706 H860 Q868.8 444.706 868.8 453.1 V468.5", "V504.5"),
    ("#28bc92", (300, 1160, 424, 1213), "M300.7 1159.9", "M325.5 1184.7 L341 1200.2 Q348.5 1207.675 360.5 1207.675 H425.8", "H461.1"),
    ("#ff9800", (295, 1165, 424, 1220), "M295.55 1165.15", "M320.8 1190.4 L335.8 1205.4 Q345.8 1215.198 360.5 1215.198 H425.8", "H461.1"),
    ("#ffcb00", (290, 1170, 424, 1228), "M290.5 1170.15", "M315.4 1195.05 L330.5 1210.15 Q342.8 1222.835 360.5 1222.835 H425.8", "H461.1"),
]
defs = ET.SubElement(svg, "defs")
# The source uses triangles at Łagiewniki ZUS. Replace their entire silhouettes,
# including the three previously detected holes, with five aligned circle stops.
zus_stops = [
    # Track-edge offsets at either end of the cleared strip, measured from the
    # existing vector. Matching these avoids steps where the repair rejoins it.
    ("#ffcb00", 311.620, 1100.471, (-2.50, 1.54, -2.14, 1.77)),
    ("#abd39d", 316.794, 1105.645, (-1.79, 2.12, -1.78, 2.14)),
    ("#28bc92", 321.968, 1110.819, (-1.79, 2.12, -1.77, 2.15)),
    ("#1470e0", 327.142, 1115.993, (-1.80, 2.11, -2.06, 2.34)),
    ("#364a74", 332.316, 1121.167, (-1.41, 2.16, -1.62, 2.29)),
]
zus_clip = ET.SubElement(defs, "clipPath", {"id": "zus-original-markers"})
ET.SubElement(zus_clip, "path", {
    "d": "M0 0H1778V1408H0Z M303.84 1101.18L312.33 1092.69L340.10 1120.46L331.61 1128.95Z",
    "clip-rule": "evenodd",
})
# Cut the old southern surface strokes back to the interchange border and the
# next stop circle, so no raster-traced shoulders remain at the tunnel portals.
surface_clip = ET.SubElement(defs, "clipPath", {"id": "tunnel-south-surface"})
ET.SubElement(surface_clip, "path", {
    "d": "M0 0H1778V1408H0Z M282.404 1178.309L312.809 1147.904L350 1185H461.1V1230H330Z",
    "clip-rule": "evenodd",
})
stop_circles = []
replaced_contours = 0
with tempfile.TemporaryDirectory(prefix="tram-trace-") as temp:
    for index, color in enumerate(palette):
        mask = keep & (nearest == index) & (distance < 10 ** 2)
        if color == (255, 106, 70):
            # Regression check: the orange route must retain its core, not just
            # its antialiased edges, along the vertical section and the bend.
            for x, y in [(476, 230), (476, 265), (476, 305), (500, 341)]:
                assert mask[round(y * sy), round(x * sx)], f"Missing orange ink at {x}, {y}"
        # vtracer binary traces black objects on white.
        bitmap = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8))
        png, vector = Path(temp) / "ink.png", Path(temp) / "ink.svg"
        bitmap.save(png)
        vtracer.convert_image_to_svg_py(
            str(png), str(vector), colormode="binary", mode="spline",
            filter_speckle=8, corner_threshold=60, length_threshold=2,
            max_iterations=10, splice_threshold=45, path_precision=2,
        )
        ink = "#%02x%02x%02x" % color
        parent = svg
        if ink in {"#28bc92", "#ff9800", "#ffcb00"}:
            parent = ET.SubElement(svg, "g", {"clip-path": "url(#tunnel-south-surface)"})
        if ink in {color for color, _, _, _ in zus_stops}:
            parent = ET.SubElement(parent, "g", {"clip-path": "url(#zus-original-markers)"})
        group = ET.SubElement(parent, "g", {
            "fill": "#%02x%02x%02x" % color,
            "transform": f"scale({1 / sx:.9f} {1 / sy:.9f})",
        })
        for path in ET.parse(vector).getroot():
            if path.tag.endswith("path"):
                attributes = {key: value for key, value in path.attrib.items() if key != "fill"}
                tx, ty = map(float, re.findall(r"-?\d+(?:\.\d+)?", attributes["transform"]))
                outlines = []
                tunnel_contour = False
                for part_index, part in enumerate(re.findall(r"M[^M]+", attributes["d"])):
                    points = list(map(float, re.findall(r"-?\d+(?:\.\d+)?", part)))
                    xs, ys = points[::2], points[1::2]
                    left, right, top, bottom = min(xs), max(xs), min(ys), max(ys)
                    if part_index == 0:
                        tunnel_contour = any(
                            ink == "#%02x%02x%02x" % color
                            and x1 <= (tx + left) / sx <= (tx + right) / sx <= x2
                            and y1 <= (ty + top) / sy <= (ty + bottom) / sy <= y2
                            for ink, (x1, y1, x2, y2), _, _, _ in tunnels
                        )
                    # VTracer's small inner contours are stop holes. Keep the
                    # outer route contour and larger/skinny gaps unchanged.
                    # ponytail: size-based detection is specific to this artwork;
                    # revisit these bounds if the reference diagram changes.
                    if part_index and 2.5 <= (right - left) / sx <= 6.5 and 2.5 <= (bottom - top) / sy <= 6.5:
                        stop_circles.append({
                            "cx": f"{(tx + (left + right) / 2) / sx:.3f}",
                            "cy": f"{(ty + (top + bottom) / 2) / sy:.3f}",
                            "stroke": "#%02x%02x%02x" % color,
                        })
                    else:
                        outlines.append(part)
                attributes["d"] = "".join(outlines)
                if tunnel_contour:
                    replaced_contours += 1
                else:
                    ET.SubElement(group, "path", attributes)

# Keep the original underpasses beneath the two north–south surface tracks.
clip = ET.SubElement(defs, "clipPath", {"id": "tunnel-crossings"})
ET.SubElement(clip, "path", {
    "d": "M0 0H1778V1408H0Z M621 378H628V469H621Z M798 378H806V469H798Z",
    "clip-rule": "evenodd",
})
tunnel_lines = ET.SubElement(svg, "g", {
    "id": "tunnel-lines", "fill": "none", "stroke-linejoin": "round",
})
for ink, bounds, approach, centerline, exit_line in tunnels:
    attrs = {}
    if bounds[1] == 320:
        attrs["clip-path"] = "url(#tunnel-crossings)"
    ET.SubElement(tunnel_lines, "path", {
        **attrs, "d": f"{approach} {centerline.replace('M', 'L', 1)} {exit_line}",
        "stroke": ink, "stroke-width": "4.2",
    })
    ET.SubElement(tunnel_lines, "path", {
        **attrs, "d": centerline, "stroke": "#241f31", "stroke-width": "1.2",
    })
assert replaced_contours == 29, f"Expected 29 tunnel/surface contours, found {replaced_contours}"

# Restore just the straight tracks under the cleared markers. Nearby route
# curves and the interchange outline remain untouched.
zus_tracks = ET.SubElement(svg, "g", {"id": "zus-tracks"})
for ink, x, y, (lo1, hi1, lo2, hi2) in zus_stops:
    ET.SubElement(zus_tracks, "path", {
        "d": f"M-6.2 {lo1}L-6.2 {hi1}L6.2 {hi2}L6.2 {lo2}Z",
        "transform": f"translate({x} {y}) rotate(-45)", "fill": ink,
    })
stop_circles = [
    stop for stop in stop_circles
    if not (308 < float(stop["cx"]) < 336 and 1097 < float(stop["cy"]) < 1125)
]
for ink, x, y, edges in zus_stops:
    offset = sum(edges) / (4 * 2 ** 0.5)
    stop_circles.append({"cx": f"{x + offset:.3f}", "cy": f"{y + offset:.3f}", "stroke": ink})

# Native circles stay round even at maximum zoom. Draw in viewBox coordinates,
# outside the trace's slightly non-uniform source-image scale.
markers = ET.SubElement(svg, "g", {
    "id": "stop-markers", "fill": "#241f31", "stroke-width": "1.8",
})
for attributes in stop_circles:
    ET.SubElement(markers, "circle", {**attributes, "r": "3.1"})

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
