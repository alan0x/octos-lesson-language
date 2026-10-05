//! Geometry cards ported from packages/web-runtime/src/board-view.ts
//! (geometryViewport, geometryArcPath, drawGeometry, angleControlValue):
//! renderer-independent primitives in the Web SVG viewBox (404×280 in a card).
use crate::plot::{latest_emphasis, plan_axis_ticks, plot_frame, range, Range, Ticks};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    pub x: Range,
    pub y: Range,
    pub scale: f64,
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}
impl Viewport {
    pub fn map_x(&self, v: f64) -> f64 {
        self.left + (v - self.x.min) * self.scale
    }
    pub fn map_y(&self, v: f64) -> f64 {
        self.top + (self.y.max - v) * self.scale
    }
}
/// Web geometryViewport (equal units, centred).
pub fn viewport(axes: &Value, ranges: Option<(Range, Range)>, width: f64, height: f64) -> Viewport {
    let default = Range { min: -1.25, max: 1.25 };
    let (x, y) = ranges.unwrap_or((range(&axes["x"], default), range(&axes["y"], default)));
    let f = plot_frame(width, height, x, y, true);
    let (fw, fh) = (f.right - f.left, f.bottom - f.top);
    let scale = (fw / x.span()).min(fh / y.span());
    let (rw, rh) = (x.span() * scale, y.span() * scale);
    let left = f.left + (fw - rw) / 2.;
    let top = f.top + (fh - rh) / 2.;
    Viewport { x, y, scale, left, right: left + rw, top, bottom: top + rh }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    GridMinor,
    Grid,
    Axis,
    Label,
    Leader,
    /// geometry-polygon-{primary,secondary,accent,neutral}
    Polygon(Tone),
    Circle,
    /// solid | dashed | projection
    Segment(SegmentStyle),
    Arc,
    Sector,
    Point,
    ControlPoint,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Primary,
    Secondary,
    Accent,
    Neutral,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentStyle {
    Solid,
    Dashed,
    Projection,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Primitive {
    Line { x1: f64, y1: f64, x2: f64, y2: f64, style: Style, emphasis: Option<String>, clip: bool },
    Polygon { points: Vec<(f64, f64)>, style: Style, emphasis: Option<String> },
    Circle { cx: f64, cy: f64, r: f64, style: Style, emphasis: Option<String>, clip: bool },
    /// Arc from start to end (screen coordinates), with the SVG flags;
    /// `points` is a polyline approximation for renderers.
    Arc { points: Vec<(f64, f64)>, closed: bool, style: Style, emphasis: Option<String> },
    Text { x: f64, y: f64, text: String, anchor: &'static str },
}
/// A draggable angle control point (web .geometry-control-point).
#[derive(Clone, Debug, PartialEq)]
pub struct AngleControl {
    pub variable: String,
    pub x: f64,
    pub y: f64,
    pub center: (f64, f64),
}
#[derive(Clone, Debug, PartialEq)]
pub struct GeometryScene {
    pub width: f64,
    pub height: f64,
    pub viewport: Viewport,
    pub primitives: Vec<Primitive>,
    pub controls: Vec<AngleControl>,
    pub caption: Option<String>,
    pub ticks: (f64, f64),
}

fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
/// SVG arc sampled as a polyline (web geometryArcPath semantics: the
/// shorter or longer arc by |delta| > π, swept with the sign of delta).
fn arc_points(v: &Viewport, center: (f64, f64), radius: f64, start: f64, end: f64) -> Vec<(f64, f64)> {
    let steps = ((end - start).abs() / (std::f64::consts::PI / 90.)).ceil().max(2.) as usize;
    (0..=steps)
        .map(|i| {
            let a = start + (end - start) * i as f64 / steps as f64;
            (v.map_x(center.0 + a.cos() * radius), v.map_y(center.1 + a.sin() * radius))
        })
        .collect()
}

/// Web drawGeometry for `node` at `width`×`height`.
pub fn geometry_scene(
    node: &Value,
    width: f64,
    height: f64,
    ranges: Option<(Range, Range)>,
    previous_ticks: Option<(f64, f64)>,
) -> GeometryScene {
    let content = &node["content"];
    let v = viewport(&content["axes"], ranges, width, height);
    let mut out = Vec::new();
    let line = |x1, y1, x2, y2, style| Primitive::Line { x1, y1, x2, y2, style, emphasis: None, clip: false };
    let label = |x, y, text: String, anchor| Primitive::Text { x, y, text, anchor };
    let xt: Ticks = plan_axis_ticks(v.x, v.right - v.left, 42., previous_ticks.map(|t| t.0));
    let yt: Ticks = plan_axis_ticks(v.y, v.bottom - v.top, 34., previous_ticks.map(|t| t.1));
    for x in &xt.minor {
        out.push(line(v.map_x(*x), v.top, v.map_x(*x), v.bottom, Style::GridMinor));
    }
    for y in &yt.minor {
        out.push(line(v.left, v.map_y(*y), v.right, v.map_y(*y), Style::GridMinor));
    }
    for x in &xt.major {
        out.push(line(v.map_x(*x), v.top, v.map_x(*x), v.bottom, Style::Grid));
        out.push(label(v.map_x(*x), height - 4., xt.format(*x), "middle"));
    }
    for y in &yt.major {
        out.push(line(v.left, v.map_y(*y), v.right, v.map_y(*y), Style::Grid));
        out.push(label(v.left - 5., v.map_y(*y) + 3., yt.format(*y), "end"));
    }
    let zero_y = (v.y.min <= 0. && v.y.max >= 0.).then(|| v.map_y(0.));
    let zero_x = (v.x.min <= 0. && v.x.max >= 0.).then(|| v.map_x(0.));
    if let Some(y) = zero_y {
        out.push(line(v.left, y, v.right, y, Style::Axis));
    }
    if let Some(x) = zero_x {
        out.push(line(x, v.top, x, v.bottom, Style::Axis));
    }
    let axes = &content["axes"];
    let axis_label = |a: &Value, d: &str| if a["label"].is_null() { d.to_owned() } else { text_of(&a["label"]) };
    out.push(label(v.right - 2., zero_y.unwrap_or(v.bottom) - 5., axis_label(&axes["x"], "x"), "end"));
    out.push(label(zero_x.unwrap_or(v.left) + 5., v.top + 10., axis_label(&axes["y"], "y"), "start"));

    // Points by id (finite only), in content order.
    let mut points: Vec<(String, Value, f64, f64)> = Vec::new();
    for p in content["points"].as_array().into_iter().flatten() {
        let (Some(x), Some(y)) = (p["x"].as_f64(), p["y"].as_f64()) else { continue };
        let id = text_of(&p["id"]);
        if !id.is_empty() && x.is_finite() && y.is_finite() {
            if let Some(slot) = points.iter_mut().find(|(i, ..)| *i == id) {
                *slot = (id, p.clone(), x, y);
            } else {
                points.push((id, p.clone(), x, y));
            }
        }
    }
    let point = |id: &Value| points.iter().find(|(i, ..)| *i == text_of(id)).map(|(_, _, x, y)| (*x, *y));

    let mut external = 0;
    for polygon in content["polygons"].as_array().into_iter().flatten() {
        let ids = polygon["points"].as_array().cloned().unwrap_or_default();
        let vertices: Vec<(f64, f64)> = ids.iter().filter_map(&point).collect();
        if vertices.len() < 3 || vertices.len() != ids.len() {
            continue;
        }
        let tone = match polygon["tone"].as_str().unwrap_or("primary") {
            "secondary" => Tone::Secondary,
            "accent" => Tone::Accent,
            "neutral" => Tone::Neutral,
            _ => Tone::Primary,
        };
        let rendered: Vec<(f64, f64)> = vertices.iter().map(|(x, y)| (v.map_x(*x), v.map_y(*y))).collect();
        out.push(Primitive::Polygon {
            points: rendered.clone(),
            style: Style::Polygon(tone),
            emphasis: latest_emphasis(node, &text_of(&polygon["id"])),
        });
        let text = text_of(&polygon["label"]);
        if !text.is_empty() {
            let n = vertices.len() as f64;
            let centroid = vertices.iter().fold((0., 0.), |s, p| (s.0 + p.0 / n, s.1 + p.1 / n));
            let xs = rendered.iter().map(|p| p.0);
            let ys = rendered.iter().map(|p| p.1);
            let pw = xs.clone().fold(f64::NEG_INFINITY, f64::max) - xs.fold(f64::INFINITY, f64::min);
            let ph = ys.clone().fold(f64::NEG_INFINITY, f64::max) - ys.fold(f64::INFINITY, f64::min);
            let est: f64 = text.chars().map(|c| if (c as u32) > 0xff { 10. } else { 6. }).sum();
            let (cx, cy) = (v.map_x(centroid.0), v.map_y(centroid.1));
            if pw >= est + 10. && ph >= 18. {
                out.push(label(cx, cy, text, "middle"));
            } else {
                let lx = v.right - 4.;
                let ly = v.top + 18. + external as f64 * 17.;
                out.push(line(cx, cy, lx - est - 5., ly - 3., Style::Leader));
                out.push(label(lx, ly, text, "end"));
                external += 1;
            }
        }
    }
    for circle in content["circles"].as_array().into_iter().flatten() {
        let Some(center) = point(&circle["center"]) else { continue };
        let Some(radius) = circle["radius"].as_f64().filter(|r| r.is_finite() && *r >= 0.) else { continue };
        let text = text_of(&circle["label"]);
        if radius == 0. {
            if !text.is_empty() {
                out.push(label(v.map_x(center.0) - 4., v.map_y(center.1) - 8., text, "end"));
            }
            continue;
        }
        out.push(Primitive::Circle {
            cx: v.map_x(center.0),
            cy: v.map_y(center.1),
            r: radius * v.scale,
            style: Style::Circle,
            emphasis: latest_emphasis(node, &text_of(&circle["id"])),
            clip: true,
        });
        if !text.is_empty() {
            out.push(label(v.map_x(center.0 + radius) - 4., v.map_y(center.1) - 8., text, "end"));
        }
    }
    for segment in content["segments"].as_array().into_iter().flatten() {
        let (Some(from), Some(to)) = (point(&segment["from"]), point(&segment["to"])) else { continue };
        let style = match segment["style"].as_str().unwrap_or("solid") {
            "dashed" => SegmentStyle::Dashed,
            "projection" => SegmentStyle::Projection,
            _ => SegmentStyle::Solid,
        };
        let (x1, y1, x2, y2) = (v.map_x(from.0), v.map_y(from.1), v.map_x(to.0), v.map_y(to.1));
        out.push(Primitive::Line {
            x1,
            y1,
            x2,
            y2,
            style: Style::Segment(style),
            emphasis: latest_emphasis(node, &text_of(&segment["id"])),
            clip: true,
        });
        let text = text_of(&segment["label"]);
        if !text.is_empty() {
            out.push(label((x1 + x2) / 2. + 5., (y1 + y2) / 2. - 6., text, "start"));
        }
    }
    for arc in content["arcs"].as_array().into_iter().flatten() {
        let Some(center) = point(&arc["center"]) else { continue };
        let n = |k: &str| arc[k].as_f64().filter(|v| v.is_finite());
        let (Some(radius), Some(start), Some(end)) = (n("radius"), n("start_angle"), n("end_angle")) else { continue };
        if radius < 0. {
            continue;
        }
        let text = text_of(&arc["label"]);
        if radius == 0. {
            if !text.is_empty() {
                out.push(label(v.map_x(center.0), v.map_y(center.1) - 8., text, "middle"));
            }
            continue;
        }
        let filled = arc["filled"] == true;
        let mut pts = arc_points(&v, center, radius, start, end);
        if filled {
            pts.push((v.map_x(center.0), v.map_y(center.1)));
        }
        out.push(Primitive::Arc {
            points: pts,
            closed: filled,
            style: if filled { Style::Sector } else { Style::Arc },
            emphasis: latest_emphasis(node, &text_of(&arc["id"])),
        });
        if !text.is_empty() {
            let middle = (start + end) / 2.;
            out.push(label(
                v.map_x(center.0 + middle.cos() * (radius + 0.1)),
                v.map_y(center.1 + middle.sin() * (radius + 0.1)),
                text,
                "middle",
            ));
        }
    }
    // Points: angle controls last (drawn on top).
    let mut ordered = points.clone();
    ordered.sort_by_key(|(_, p, ..)| (p["interaction"]["kind"] == "angle_control") as u8);
    let mut controls = Vec::new();
    for (id, p, px, py) in &ordered {
        if p["visible"] == false || p["binding_undefined"] == true {
            continue;
        }
        let (x, y) = (v.map_x(*px), v.map_y(*py));
        let interaction = &p["interaction"];
        let center = (interaction["kind"] == "angle_control").then(|| point(&interaction["center"])).flatten();
        let control = match (center, interaction["variable"].as_str()) {
            (Some(c), Some(variable)) => {
                controls.push(AngleControl {
                    variable: variable.to_owned(),
                    x,
                    y,
                    center: (v.map_x(c.0), v.map_y(c.1)),
                });
                true
            }
            _ => false,
        };
        out.push(Primitive::Circle {
            cx: x,
            cy: y,
            r: if control { 6. } else { 4.5 },
            style: if control { Style::ControlPoint } else { Style::Point },
            emphasis: latest_emphasis(node, id),
            clip: true,
        });
        let text = text_of(&p["label"]);
        if !text.is_empty() {
            out.push(label(x + 7., y - 7., text, "start"));
        }
    }
    GeometryScene {
        width,
        height,
        viewport: v,
        primitives: out,
        controls,
        caption: content["caption"].as_str().filter(|s| !s.is_empty()).map(str::to_owned),
        ticks: (xt.step, yt.step),
    }
}

/// Web angleControlValue: the variable value for a pointer angle, staying
/// on the turn closest to the current value within [min, max].
pub fn angle_control_value(raw: f64, current: f64, min: f64, max: f64, unit: &str) -> f64 {
    let u = unit.trim().to_lowercase();
    let radians = u.contains('弧') || u.contains("radian") || u.contains("rad");
    let degrees = !radians && (u.contains('角') || u.contains('度') || u.contains('°') || u.contains("degree") || u.contains("deg"));
    let at = if degrees { raw.to_degrees() } else { raw };
    let turn = if degrees { 360. } else { std::f64::consts::TAU };
    let first = ((min - at) / turn - 1e-10).ceil();
    let last = ((max - at) / turn + 1e-10).floor();
    if first <= last {
        let closest = last.min(first.max(((current - at) / turn).round()));
        return (at + closest * turn).clamp(min, max);
    }
    at.clamp(min, max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unit_circle_scene_and_angle_turns() {
        let node = json!({"kind": "geometry", "content": {
            "axes": {"x": {"min": -1.4, "max": 1.4}, "y": {"min": -1.4, "max": 1.4}},
            "points": [{"id": "o", "x": 0, "y": 0}, {"id": "p", "x": 0, "y": 1, "label": "P",
                "interaction": {"kind": "angle_control", "center": "o", "variable": "t"}}],
            "circles": [{"id": "c", "center": "o", "radius": 1}],
            "segments": [{"id": "s", "from": "o", "to": "p", "style": "dashed"}]}});
        let s = geometry_scene(&node, 404., 280., None, None);
        assert_eq!(s.controls.len(), 1);
        let v = s.viewport;
        assert!((v.right - v.left - (v.bottom - v.top)).abs() < 1e-9, "equal units");
        assert!((s.controls[0].x - v.map_x(0.)).abs() < 1e-9);
        // A pointer at 90° while the value is near 2π+π/2 stays on that turn.
        let tau = std::f64::consts::TAU;
        let value = angle_control_value(std::f64::consts::FRAC_PI_2, tau + 1.5, 0., 3. * tau, "rad");
        assert!((value - (tau + std::f64::consts::FRAC_PI_2)).abs() < 1e-12);
        assert_eq!(angle_control_value(1., 0., 0., 360., "度"), 1f64.to_degrees());
    }
}
