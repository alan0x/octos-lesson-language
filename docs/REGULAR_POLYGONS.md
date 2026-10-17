# Regular polygon geometry

Geometry content supports `regular_polygons`: alias, center point reference, reference-circle radius, integer sides (3..384), relation (`inscribed` or `circumscribed`), optional rotation in radians, tone, label, and show_measurements. It reuses the existing geometry explorer. Numeric bindings support sides, radius, rotation. Animation uses integral topology; no radius or center movement is implied by a change of side count.

The shared pure construction computes vertices and perimeter. Inscribed circumradius is r, circumscribed circumradius is r/cos(pi/n). Measurements show perimeter and perimeter/(2r), with explicitly approximate decimal values. Polygon strokes are unfilled so the circle remains visible. Feature `geometry:regular-polygons` requires execution version 0.4.0; existing content keeps its prior minimum version.

Validation covers schema, references, bounded inputs, normalization, binding, deterministic restoration, and every side count 3..384 for equal edges, tangency, perimeter and monotonic bounds. All 351 existing and new runtime tests pass.
