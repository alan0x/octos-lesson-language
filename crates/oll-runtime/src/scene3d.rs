//! scene3d geometry ported from packages/web-runtime/src/scene3d.ts.
//! Produces renderer-neutral primitives in the web SVG viewBox (420x270),
//! already wrapped in the web "fitted frame" transform, so a host only has
//! to scale the viewBox into its card and paint the primitives in order.
use crate::expression::{evaluate, Variables};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub const WIDTH: f64 = 420.;
pub const HEIGHT: f64 = 270.;
const CENTER_X: f64 = WIDTH / 2.;
const CENTER_Y: f64 = HEIGHT / 2. + 8.;
const SCALE: f64 = 54.;
const MAX_IMPLICIT_SURFACE_TRIANGLES: usize = 20_000;
const INTERSECTION_EPSILON: f64 = 1e-7;
const POINT_KEY_SCALE: f64 = 1e6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub yaw: f64,
    pub pitch: f64,
    pub zoom: f64,
}
impl View {
    /// Web normalizeScene3dView.
    pub fn normalized(self) -> Self {
        let pitch = if self.pitch.is_finite() {
            self.pitch
        } else {
            0.45
        };
        let zoom = if self.zoom.is_finite() { self.zoom } else { 1. };
        Self {
            yaw: if self.yaw.is_finite() { self.yaw } else { 0. },
            pitch: pitch.clamp(-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2),
            zoom: zoom.clamp(0.2, 5.),
        }
    }
    /// The authored camera, or the web default when absent.
    pub fn initial(content: &Value) -> Self {
        let camera = &content["camera"];
        if camera.is_object() {
            Self {
                yaw: camera["yaw"].as_f64().unwrap_or(f64::NAN),
                pitch: camera["pitch"].as_f64().unwrap_or(f64::NAN),
                zoom: camera["zoom"].as_f64().unwrap_or(f64::NAN),
            }
            .normalized()
        } else {
            Self {
                yaw: 0.65,
                pitch: 0.5,
                zoom: 1.,
            }
        }
    }
    /// Orbit drag delta in CSS px (web pointermove factors).
    pub fn orbit(self, dx: f64, dy: f64) -> Self {
        Self {
            yaw: self.yaw + dx * 0.012,
            pitch: self.pitch - dy * 0.01,
            ..self
        }
        .normalized()
    }
    /// Wheel delta in CSS px (web wheel factor).
    pub fn wheel(self, delta_y: f64) -> Self {
        Self {
            zoom: self.zoom * (-delta_y * 0.0015).exp(),
            ..self
        }
        .normalized()
    }
}
/// Web preset buttons, in display order: 等轴 / 正视 / 俯视.
pub const PRESETS: [(&str, View); 3] = [
    (
        "等轴",
        View {
            yaw: 0.72,
            pitch: 0.55,
            zoom: 1.,
        },
    ),
    (
        "正视",
        View {
            yaw: 0.,
            pitch: 0.,
            zoom: 1.,
        },
    ),
    (
        "俯视",
        View {
            yaw: 0.,
            pitch: std::f64::consts::FRAC_PI_2,
            zoom: 1.,
        },
    ),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
fn p3(x: f64, y: f64, z: f64) -> Point3 {
    Point3 { x, y, z }
}
impl Point3 {
    fn axis(self, axis: char) -> f64 {
        match axis {
            'x' => self.x,
            'y' => self.y,
            _ => self.z,
        }
    }
    fn lerp(self, to: Self, t: f64) -> Self {
        p3(
            self.x + (to.x - self.x) * t,
            self.y + (to.y - self.y) * t,
            self.z + (to.z - self.z) * t,
        )
    }
    fn distance2(self, to: Self) -> f64 {
        (self.x - to.x).powi(2) + (self.y - to.y).powi(2) + (self.z - to.z).powi(2)
    }
    fn from_json(v: &Value) -> Result<Self, String> {
        let n = |k: &str| {
            v[k].as_f64()
                .ok_or_else(|| format!("Missing 3D coordinate {k}"))
        };
        Ok(p3(n("x")?, n("y")?, n("z")?))
    }
}

/// Web projectScene3dPoint: (x, y) in viewBox units plus a depth key.
pub fn project(point: Point3, view: View, scale: f64) -> (f64, f64, f64) {
    let v = view.normalized();
    let (sin_yaw, cos_yaw) = v.yaw.sin_cos();
    let (sin_pitch, cos_pitch) = v.pitch.sin_cos();
    let horizontal = cos_yaw * point.x - sin_yaw * point.y;
    let depth_before_pitch = sin_yaw * point.x + cos_yaw * point.y;
    let vertical = cos_pitch * point.z - sin_pitch * depth_before_pitch;
    let depth = sin_pitch * point.z + cos_pitch * depth_before_pitch;
    (
        CENTER_X + horizontal * scale * v.zoom,
        CENTER_Y - vertical * scale * v.zoom,
        depth,
    )
}
fn xy(point: Point3, view: View) -> (f64, f64) {
    let (x, y, _) = project(point, view, SCALE);
    (x, y)
}
fn depth(points: &[Point3], view: View) -> f64 {
    points
        .iter()
        .map(|p| project(*p, view, SCALE).2)
        .sum::<f64>()
        / points.len() as f64
}

/// Web safeColor: the allow-listed names are CSS named colors.
pub fn color(value: &Value, fallback: u32) -> u32 {
    let Some(s) = value.as_str() else {
        return fallback;
    };
    match s {
        "teal" => 0x008080,
        "blue" => 0x0000ff,
        "purple" => 0x800080,
        "orange" => 0xffa500,
        "red" => 0xff0000,
        "gray" => 0x808080,
        _ if s.len() == 7 && s.starts_with('#') => {
            u32::from_str_radix(&s[1..], 16).unwrap_or(fallback)
        }
        _ => fallback,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TextStyle {
    /// .scene3d-axis-label: #5f6f6b, 700 11px monospace.
    Axis,
    /// .scene3d-highlight-label: #8d302a with a 3px white halo, 700 11px.
    Highlight,
}
/// Paint primitives in painter order. Coordinates are viewBox units after the
/// fitted frame; `stroke_width` is in screen px (web vector-effect:
/// non-scaling-stroke) unless `scales` is set.
#[derive(Clone, Debug, PartialEq)]
pub enum Prim {
    Path {
        points: Vec<(f64, f64)>,
        closed: bool,
        fill: Option<(u32, f64)>,
        stroke: Option<(u32, f64)>,
        stroke_width: f64,
        /// SVG stroke-dasharray in screen px.
        dash: Option<(f64, f64)>,
        round: bool,
        /// Stroke scales with the frame (no non-scaling-stroke class).
        scales: bool,
        id: String,
    },
    Circle {
        center: (f64, f64),
        radius: f64,
        fill: u32,
        stroke: u32,
        stroke_width: f64,
        id: String,
    },
    Text {
        at: (f64, f64),
        text: String,
        style: TextStyle,
    },
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawing {
    pub prims: Vec<Prim>,
    /// Fitted-frame scale; text (font 11px) scales with it.
    pub text_scale: f64,
}

#[derive(Clone, Debug)]
struct Mesh {
    target: String,
    solid: bool,
    triangles: Vec<[Point3; 3]>,
}
fn target(object: &Value) -> String {
    object["id"]
        .as_str()
        .or(object["as"].as_str())
        .unwrap_or("")
        .to_owned()
}
fn range(v: &Value, key: &str) -> Result<(f64, f64), String> {
    let r = &v[key];
    Ok((
        r["min"]
            .as_f64()
            .ok_or_else(|| format!("Missing {key}.min"))?,
        r["max"]
            .as_f64()
            .ok_or_else(|| format!("Missing {key}.max"))?,
    ))
}
fn samples(object: &Value, max: f64) -> usize {
    let n = object["samples"]
        .as_f64()
        .filter(|n| *n != 0. && n.is_finite());
    n.unwrap_or(12.).clamp(4., max) as usize
}
fn surface_grid(object: &Value, variables: &Variables) -> Result<Vec<Vec<Point3>>, String> {
    let n = samples(object, 24.);
    let expression = object["expression"]
        .as_str()
        .ok_or("Missing surface expression")?;
    let (x0, x1) = range(object, "x_range")?;
    let (y0, y1) = range(object, "y_range")?;
    let mut values = variables.clone();
    let mut grid = Vec::with_capacity(n + 1);
    for xi in 0..=n {
        let x = x0 + (x1 - x0) * xi as f64 / n as f64;
        let mut column = Vec::with_capacity(n + 1);
        for yi in 0..=n {
            let y = y0 + (y1 - y0) * yi as f64 / n as f64;
            values.insert("x".into(), x);
            values.insert("y".into(), y);
            column.push(p3(x, y, evaluate(expression, &values)?));
        }
        grid.push(column);
    }
    Ok(grid)
}
fn surface_mesh(object: &Value, variables: &Variables) -> Result<Mesh, String> {
    let grid = surface_grid(object, variables)?;
    let n = grid.len() - 1;
    let mut triangles = Vec::with_capacity(n * n * 2);
    for xi in 0..n {
        for yi in 0..n {
            let (a, b, c, d) = (
                grid[xi][yi],
                grid[xi + 1][yi],
                grid[xi + 1][yi + 1],
                grid[xi][yi + 1],
            );
            triangles.push([a, b, c]);
            triangles.push([a, c, d]);
        }
    }
    Ok(Mesh {
        target: target(object),
        solid: false,
        triangles,
    })
}
fn tetrahedron(points: [Point3; 4], values: [f64; 4]) -> Vec<[Point3; 3]> {
    if values.iter().any(|v| !v.is_finite()) {
        return Vec::new();
    }
    let inside: Vec<usize> = (0..4).filter(|&i| values[i] <= 0.).collect();
    let outside: Vec<usize> = (0..4).filter(|&i| values[i] > 0.).collect();
    let crossing = |from: usize, to: usize| {
        let denominator = values[from] - values[to];
        let amount = if denominator.abs() < 1e-12 {
            0.5
        } else {
            values[from] / denominator
        };
        points[from].lerp(points[to], amount)
    };
    match inside.len() {
        1 => vec![[
            crossing(inside[0], outside[0]),
            crossing(inside[0], outside[1]),
            crossing(inside[0], outside[2]),
        ]],
        3 => vec![[
            crossing(outside[0], inside[2]),
            crossing(outside[0], inside[1]),
            crossing(outside[0], inside[0]),
        ]],
        2 => {
            let a = crossing(inside[0], outside[0]);
            let b = crossing(inside[0], outside[1]);
            let c = crossing(inside[1], outside[0]);
            let d = crossing(inside[1], outside[1]);
            vec![[a, b, c], [b, d, c]]
        }
        _ => Vec::new(),
    }
}
fn implicit_surface_mesh(object: &Value, variables: &Variables) -> Result<Mesh, String> {
    let n = samples(object, 18.);
    let level = object["level"].as_f64().unwrap_or(0.);
    let expression = object["expression"]
        .as_str()
        .ok_or("Missing implicit surface expression")?;
    let ranges = [
        range(object, "x_range")?,
        range(object, "y_range")?,
        range(object, "z_range")?,
    ];
    let at = |axis: usize, i: usize| {
        ranges[axis].0 + (ranges[axis].1 - ranges[axis].0) * i as f64 / n as f64
    };
    let mut values = variables.clone();
    let mut grid = vec![vec![vec![(p3(0., 0., 0.), 0.); n + 1]; n + 1]; n + 1];
    for (xi, plane) in grid.iter_mut().enumerate() {
        for (yi, column) in plane.iter_mut().enumerate() {
            for (zi, cell) in column.iter_mut().enumerate() {
                let point = p3(at(0, xi), at(1, yi), at(2, zi));
                values.insert("x".into(), point.x);
                values.insert("y".into(), point.y);
                values.insert("z".into(), point.z);
                *cell = (point, evaluate(expression, &values)? - level);
            }
        }
    }
    const CUBE_TETRAHEDRA: [[usize; 4]; 6] = [
        [0, 1, 2, 6],
        [0, 2, 3, 6],
        [0, 3, 7, 6],
        [0, 7, 4, 6],
        [0, 4, 5, 6],
        [0, 5, 1, 6],
    ];
    let mut triangles = Vec::new();
    for x in 0..n {
        for y in 0..n {
            for z in 0..n {
                let v = [
                    grid[x][y][z],
                    grid[x + 1][y][z],
                    grid[x + 1][y + 1][z],
                    grid[x][y + 1][z],
                    grid[x][y][z + 1],
                    grid[x + 1][y][z + 1],
                    grid[x + 1][y + 1][z + 1],
                    grid[x][y + 1][z + 1],
                ];
                for t in CUBE_TETRAHEDRA {
                    triangles.extend(tetrahedron(t.map(|i| v[i].0), t.map(|i| v[i].1)));
                    if triangles.len() > MAX_IMPLICIT_SURFACE_TRIANGLES {
                        return Err(
                            "Implicit 3D surface is too complex for interactive rendering".into(),
                        );
                    }
                }
            }
        }
    }
    Ok(Mesh {
        target: target(object),
        solid: true,
        triangles,
    })
}
fn box_faces(object: &Value) -> Result<Vec<[Point3; 4]>, String> {
    let c = Point3::from_json(&object["center"])?;
    let s = Point3::from_json(&object["size"])?;
    let xs = [c.x - s.x / 2., c.x + s.x / 2.];
    let ys = [c.y - s.y / 2., c.y + s.y / 2.];
    let zs = [c.z - s.z / 2., c.z + s.z / 2.];
    let p = |x: usize, y: usize, z: usize| p3(xs[x], ys[y], zs[z]);
    Ok(vec![
        [p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)],
        [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
        [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)],
        [p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1)],
        [p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)],
        [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
    ])
}
fn radial(center: Point3, radius: f64, z: f64, angle: f64) -> Point3 {
    p3(
        center.x + angle.cos() * radius,
        center.y + angle.sin() * radius,
        z,
    )
}
fn num(object: &Value, key: &str) -> Result<f64, String> {
    object[key]
        .as_f64()
        .ok_or_else(|| format!("Missing 3D object {key}"))
}
fn primitive_mesh(object: &Value) -> Result<Mesh, String> {
    let target = target(object);
    let kind = object["kind"].as_str().unwrap_or("");
    let mut triangles = Vec::new();
    if kind == "box" {
        for f in box_faces(object)? {
            triangles.push([f[0], f[1], f[2]]);
            triangles.push([f[0], f[2], f[3]]);
        }
        return Ok(Mesh {
            target,
            solid: true,
            triangles,
        });
    }
    if !matches!(kind, "sphere" | "cone" | "cylinder") {
        return Err(format!("Unsupported 3D object kind {kind}"));
    }
    let center = Point3::from_json(&object["center"])?;
    let radius = num(object, "radius")?;
    let segments = 24;
    let tau = std::f64::consts::TAU;
    if kind == "sphere" {
        let latitudes = 12;
        let rows: Vec<Vec<Point3>> = (0..=latitudes)
            .map(|lat| {
                let phi = -std::f64::consts::FRAC_PI_2
                    + std::f64::consts::PI * lat as f64 / latitudes as f64;
                let ring = radius * phi.cos();
                let z = center.z + radius * phi.sin();
                (0..segments)
                    .map(|lon| radial(center, ring, z, tau * lon as f64 / segments as f64))
                    .collect()
            })
            .collect();
        for lat in 0..latitudes {
            for lon in 0..segments {
                let next = (lon + 1) % segments;
                let (a, b, c, d) = (
                    rows[lat][lon],
                    rows[lat + 1][lon],
                    rows[lat + 1][next],
                    rows[lat][next],
                );
                if lat > 0 {
                    triangles.push([a, b, d]);
                }
                if lat < latitudes - 1 {
                    triangles.push([d, b, c]);
                }
            }
        }
        return Ok(Mesh {
            target,
            solid: true,
            triangles,
        });
    }
    let height = num(object, "height")?;
    let top_z = center.z + height / 2.;
    let bottom_z = center.z - height / 2.;
    let bottom_center = p3(center.x, center.y, bottom_z);
    let top_center = p3(center.x, center.y, top_z);
    for i in 0..segments {
        let next = (i + 1) % segments;
        let angle = tau * i as f64 / segments as f64;
        let next_angle = tau * next as f64 / segments as f64;
        let bottom = radial(center, radius, bottom_z, angle);
        let bottom_next = radial(center, radius, bottom_z, next_angle);
        triangles.push([bottom_center, bottom_next, bottom]);
        if kind == "cone" {
            triangles.push([top_center, bottom, bottom_next]);
        } else {
            let top = radial(center, radius, top_z, angle);
            let top_next = radial(center, radius, top_z, next_angle);
            triangles.push([bottom, top, top_next]);
            triangles.push([bottom, top_next, bottom_next]);
            triangles.push([top_center, top, top_next]);
        }
    }
    Ok(Mesh {
        target,
        solid: true,
        triangles,
    })
}
fn objects(content: &Value) -> &[Value] {
    content["objects"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
fn meshes(content: &Value, variables: &Variables) -> Result<Vec<Mesh>, String> {
    objects(content)
        .iter()
        .map(|object| match object["kind"].as_str() {
            Some("surface") => surface_mesh(object, variables),
            Some("implicit_surface") => implicit_surface_mesh(object, variables),
            _ => primitive_mesh(object),
        })
        .collect()
}

type Key = (i64, i64, i64);
fn key(p: Point3) -> Key {
    // JS Math.round rounds half up; floor(v + 0.5) matches it for negatives.
    let r = |v: f64| (v * POINT_KEY_SCALE + 0.5).floor() as i64;
    (r(p.x), r(p.y), r(p.z))
}
fn segment_key(a: Point3, b: Point3) -> (Key, Key) {
    let (ka, kb) = (key(a), key(b));
    if ka < kb {
        (ka, kb)
    } else {
        (kb, ka)
    }
}
/// Insertion-ordered map, mirroring JS Map iteration order.
struct Ordered<K, V> {
    index: BTreeMap<K, usize>,
    items: Vec<V>,
}
impl<K: Ord, V> Ordered<K, V> {
    fn new() -> Self {
        Self {
            index: BTreeMap::new(),
            items: Vec::new(),
        }
    }
    fn set(&mut self, k: K, v: V) {
        match self.index.get(&k) {
            Some(&i) => self.items[i] = v,
            None => {
                self.index.insert(k, self.items.len());
                self.items.push(v);
            }
        }
    }
    fn get(&self, k: &K) -> Option<&V> {
        self.index.get(k).map(|&i| &self.items[i])
    }
}
fn plane_segments(mesh: &Mesh, axis: char, value: f64) -> Vec<(Point3, Point3)> {
    let mut ordinary = Ordered::new();
    let mut coplanar: Ordered<(Key, Key), ((Point3, Point3), usize)> = Ordered::new();
    for t in &mesh.triangles {
        let d = t.map(|p| p.axis(axis) - value);
        if d.iter().all(|d| d.abs() <= INTERSECTION_EPSILON) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                let k = segment_key(a, b);
                let count = coplanar.get(&k).map_or(0, |e| e.1);
                coplanar.set(k, ((a, b), count + 1));
            }
            continue;
        }
        let mut points: Ordered<Key, Point3> = Ordered::new();
        for (from, to) in [(0, 1), (1, 2), (2, 0)] {
            if d[from].abs() <= INTERSECTION_EPSILON {
                points.set(key(t[from]), t[from]);
            }
            if d[from] * d[to] < 0. {
                let p = t[from].lerp(t[to], d[from] / (d[from] - d[to]));
                points.set(key(p), p);
            }
        }
        let c = &points.items;
        if c.len() < 2 {
            continue;
        }
        let mut pair = (c[0], c[1]);
        for l in 0..c.len() {
            for r in l + 1..c.len() {
                if c[l].distance2(c[r]) > pair.0.distance2(pair.1) {
                    pair = (c[l], c[r]);
                }
            }
        }
        if pair.0.distance2(pair.1) <= INTERSECTION_EPSILON.powi(2) {
            continue;
        }
        ordinary.set(segment_key(pair.0, pair.1), pair);
    }
    for (k, i) in &coplanar.index {
        let (segment, count) = coplanar.items[*i];
        if count % 2 == 1 {
            ordinary.set(*k, segment);
        }
    }
    ordinary.items
}
fn chain(segments: &[(Point3, Point3)]) -> Vec<(Vec<Point3>, bool)> {
    let mut endpoints: BTreeMap<Key, Vec<usize>> = BTreeMap::new();
    for (i, (a, b)) in segments.iter().enumerate() {
        for p in [a, b] {
            endpoints.entry(key(*p)).or_default().push(i);
        }
    }
    let mut unused: BTreeSet<usize> = (0..segments.len()).collect();
    let mut paths = Vec::new();
    while let Some(&fallback) = unused.iter().next() {
        let (fa, fb) = segments[fallback];
        let open_end = |p: Point3| {
            endpoints
                .get(&key(p))
                .map_or(0, |v| v.iter().filter(|i| unused.contains(i)).count())
                == 1
        };
        let start = if open_end(fa) {
            fa
        } else if open_end(fb) {
            fb
        } else {
            fa
        };
        let mut points = vec![start];
        let start_key = key(start);
        let mut current = start_key;
        loop {
            let Some(next) = endpoints
                .get(&current)
                .and_then(|v| v.iter().find(|i| unused.contains(i)).copied())
            else {
                break;
            };
            unused.remove(&next);
            let (a, b) = segments[next];
            let p = if key(a) == current { b } else { a };
            points.push(p);
            current = key(p);
            if current == start_key {
                break;
            }
        }
        let closed = points.len() > 2 && current == start_key;
        if closed {
            points.pop();
        }
        if points.len() >= 2 {
            paths.push((points, closed));
        }
    }
    paths
}
fn section_axis(section: &Value) -> Option<char> {
    match section["axis"].as_str() {
        Some("x") => Some('x'),
        Some("y") => Some('y'),
        Some("z") => Some('z'),
        _ => None,
    }
}
fn section_targets(section: &Value) -> BTreeSet<String> {
    section["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
        .collect()
}
/// Web scene3dSectionIntersections: (target, solid, closed, points).
fn intersections(meshes: &[Mesh], section: &Value) -> Vec<(String, bool, bool, Vec<Point3>)> {
    if section["display"].as_str().unwrap_or("plane") == "plane" {
        return Vec::new();
    }
    let targets = section_targets(section);
    let (Some(axis), Some(value)) = (section_axis(section), section["value"].as_f64()) else {
        return Vec::new();
    };
    if targets.is_empty() {
        return Vec::new();
    }
    meshes
        .iter()
        .filter(|m| targets.contains(&m.target))
        .flat_map(|m| {
            chain(&plane_segments(m, axis, value))
                .into_iter()
                .map(|(points, closed)| (m.target.clone(), m.solid, closed, points))
        })
        .collect()
}
fn section_plane(section: &Value, meshes: &[Mesh]) -> Vec<Point3> {
    let targets = section_targets(section);
    let selected: Vec<&Mesh> = meshes
        .iter()
        .filter(|m| targets.is_empty() || targets.contains(&m.target))
        .collect();
    let points: Vec<Point3> = selected
        .iter()
        .flat_map(|m| m.triangles.iter().flatten().copied())
        .collect();
    let span = |axis: char| {
        if points.is_empty() {
            return (-2.5, 2.5);
        }
        let (min, max) = points
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                (lo.min(p.axis(axis)), hi.max(p.axis(axis)))
            });
        let padding = f64::max(0.2, (max - min) * 0.12);
        (min - padding, max + padding)
    };
    let (xs, ys, zs) = (span('x'), span('y'), span('z'));
    let v = section["value"].as_f64().unwrap_or(f64::NAN);
    match section["axis"].as_str() {
        Some("x") => vec![
            p3(v, ys.0, zs.0),
            p3(v, ys.1, zs.0),
            p3(v, ys.1, zs.1),
            p3(v, ys.0, zs.1),
        ],
        Some("y") => vec![
            p3(xs.0, v, zs.0),
            p3(xs.1, v, zs.0),
            p3(xs.1, v, zs.1),
            p3(xs.0, v, zs.1),
        ],
        _ => vec![
            p3(xs.0, ys.0, v),
            p3(xs.1, ys.0, v),
            p3(xs.1, ys.1, v),
            p3(xs.0, ys.1, v),
        ],
    }
}
fn id_of(v: &Value) -> String {
    target(v)
}
fn polygon(points: &[Point3], view: View, color: u32, opacity: f64, id: String) -> Prim {
    Prim::Path {
        points: points.iter().map(|p| xy(*p, view)).collect(),
        closed: true,
        fill: Some((color, opacity)),
        stroke: Some((color, 1.)),
        stroke_width: 1.1,
        dash: None,
        round: true,
        scales: false,
        id,
    }
}
/// Sampled SVG elliptical arc `A rx ry 0 0 0 (x1,y1)` from (x0,y0) for the
/// horizontal-diameter arcs the web uses on cones and cylinders (large-arc 0,
/// sweep 0, both endpoints on the major axis: a half ellipse drawn
/// counter-clockwise in SVG's y-down space, i.e. through the bottom side).
fn half_ellipse(from: (f64, f64), to: (f64, f64), ry: f64) -> Vec<(f64, f64)> {
    let cx = (from.0 + to.0) / 2.;
    let cy = (from.1 + to.1) / 2.;
    let rx = (to.0 - from.0) / 2.;
    (1..=24)
        .map(|i| {
            let t = std::f64::consts::PI * i as f64 / 24.;
            // Start at `from` (angle pi) and sweep through +y (down).
            let a = std::f64::consts::PI - t;
            (cx + rx * a.cos(), cy + ry * a.sin())
        })
        .collect()
}

/// Web renderScene: the full painter-ordered primitive list for one view.
pub fn render(content: &Value, view: View, variables: &Variables) -> Result<Drawing, String> {
    let view = view.normalized();
    let meshes = meshes(content, variables)?;
    let mut prims = Vec::new();
    let axes = content["axes"] != Value::Bool(false);
    let axis_ends = [
        ("x", p3(2.7, 0., 0.), 0xc75b52),
        ("y", p3(0., 2.7, 0.), 0x377fa4),
        ("z", p3(0., 0., 2.7), 0x377568),
    ];
    if axes {
        for (name, end, c) in axis_ends {
            prims.push(Prim::Path {
                points: vec![xy(p3(0., 0., 0.), view), xy(end, view)],
                closed: false,
                fill: None,
                stroke: Some((c, 1.)),
                stroke_width: 1.7,
                dash: None,
                round: false,
                scales: false,
                id: String::new(),
            });
            let (x, y) = xy(end, view);
            prims.push(Prim::Text {
                at: (x + 5., y - 4.),
                text: name.into(),
                style: TextStyle::Axis,
            });
        }
    }
    let mut faces: Vec<(Vec<Point3>, u32, f64, String)> = Vec::new();
    for object in objects(content) {
        let c = color(&object["color"], 0x277c75);
        let id = id_of(object);
        match object["kind"].as_str().unwrap_or("") {
            "surface" => {
                let grid = surface_grid(object, variables)?;
                let n = grid.len() - 1;
                let surface_color = color(&object["color"], 0x3479a8);
                let mut cells = Vec::with_capacity(n * n);
                for x in 0..n {
                    for y in 0..n {
                        let pts = [
                            grid[x][y],
                            grid[x + 1][y],
                            grid[x + 1][y + 1],
                            grid[x][y + 1],
                        ];
                        cells.push((depth(&pts, view), pts));
                    }
                }
                cells.sort_by(|a, b| a.0.total_cmp(&b.0));
                for (_, pts) in cells {
                    let mut prim = polygon(&pts, view, surface_color, 0.22, id.clone());
                    if let Prim::Path { stroke, .. } = &mut prim {
                        *stroke = Some((surface_color, 0.42));
                    }
                    prims.push(prim);
                }
            }
            "implicit_surface" => {
                let implicit_color = color(&object["color"], 0x3479a8);
                if let Some(mesh) = meshes.iter().find(|m| m.target == id) {
                    let mut tris: Vec<_> =
                        mesh.triangles.iter().map(|t| (depth(t, view), t)).collect();
                    tris.sort_by(|a, b| a.0.total_cmp(&b.0));
                    for (_, t) in tris {
                        let mut prim = polygon(t, view, implicit_color, 0.24, id.clone());
                        if let Prim::Path {
                            stroke_width,
                            scales,
                            ..
                        } = &mut prim
                        {
                            // No stylesheet rule: SVG default 1px, scaled.
                            *stroke_width = 1.;
                            *scales = true;
                        }
                        prims.push(prim);
                    }
                }
            }
            "box" => {
                for f in box_faces(object)? {
                    faces.push((f.to_vec(), c, depth(&f, view), id.clone()));
                }
            }
            kind @ ("sphere" | "cone" | "cylinder") => {
                let center = Point3::from_json(&object["center"])?;
                let (px, py) = xy(center, view);
                let radius = num(object, "radius")? * SCALE * view.zoom;
                let points = if kind == "sphere" {
                    (0..48)
                        .map(|i| {
                            let a = std::f64::consts::TAU * i as f64 / 48.;
                            (px + radius * a.cos(), py + radius * 0.74 * a.sin())
                        })
                        .collect()
                } else {
                    let h = num(object, "height")? / 2.;
                    let top = xy(p3(center.x, center.y, center.z + h), view);
                    let bottom = xy(p3(center.x, center.y, center.z - h), view);
                    let mut pts = if kind == "cone" {
                        vec![top, (bottom.0 - radius, bottom.1)]
                    } else {
                        vec![(top.0 - radius, top.1), (bottom.0 - radius, bottom.1)]
                    };
                    pts.extend(half_ellipse(
                        (bottom.0 - radius, bottom.1),
                        (bottom.0 + radius, bottom.1),
                        radius * 0.3,
                    ));
                    if kind == "cylinder" {
                        pts.push((top.0 + radius, top.1));
                        // Top arc runs right to left: mirror of the bottom arc.
                        let back = half_ellipse(
                            (top.0 - radius, top.1),
                            (top.0 + radius, top.1),
                            -radius * 0.3,
                        );
                        pts.extend(back.into_iter().rev().skip(1));
                    }
                    pts
                };
                let opacity = if kind == "cylinder" { 0.25 } else { 0.28 };
                prims.push(Prim::Path {
                    points,
                    closed: true,
                    fill: Some((c, opacity)),
                    stroke: Some((c, 1.)),
                    stroke_width: 1.1,
                    dash: None,
                    round: true,
                    scales: false,
                    id,
                });
            }
            kind => return Err(format!("Unsupported 3D object kind {kind}")),
        }
    }
    faces.sort_by(|a, b| a.2.total_cmp(&b.2));
    for (pts, c, _, id) in faces {
        prims.push(polygon(&pts, view, c, 0.23, id));
    }
    for section in content["sections"].as_array().into_iter().flatten() {
        let c = color(&section["color"], 0xd28a31);
        let id = id_of(section);
        if section["display"].as_str() != Some("intersection") {
            let mut prim = polygon(&section_plane(section, &meshes), view, c, 0.12, id.clone());
            if let Prim::Path {
                stroke_width, dash, ..
            } = &mut prim
            {
                *stroke_width = 1.8;
                *dash = Some((5., 4.));
            }
            prims.push(prim);
        }
        for (_, solid, closed, points) in intersections(&meshes, section) {
            let fill = (solid && closed).then_some((c, 0.38));
            prims.push(Prim::Path {
                points: points.iter().map(|p| xy(*p, view)).collect(),
                closed,
                fill,
                stroke: Some((c, 1.)),
                stroke_width: if solid { 3.2 } else { 3.6 },
                dash: None,
                round: true,
                scales: false,
                id: id.clone(),
            });
        }
    }
    for highlight in content["highlights"].as_array().into_iter().flatten() {
        let points = highlight["points"]
            .as_array()
            .into_iter()
            .flatten()
            .map(Point3::from_json)
            .collect::<Result<Vec<_>, _>>()?;
        let c = color(&highlight["color"], 0xd04f45);
        let id = id_of(highlight);
        let label_at = match highlight["kind"].as_str() {
            Some("point") => {
                let at = xy(*points.first().ok_or("Empty highlight")?, view);
                prims.push(Prim::Circle {
                    center: at,
                    radius: 7.,
                    fill: c,
                    stroke: 0xffffff,
                    stroke_width: 2.,
                    id,
                });
                at
            }
            Some("edge") => {
                if points.len() < 2 {
                    return Err("Edge highlight needs two points".into());
                }
                let (a, b) = (xy(points[0], view), xy(points[1], view));
                prims.push(Prim::Path {
                    points: vec![a, b],
                    closed: false,
                    fill: None,
                    stroke: Some((c, 1.)),
                    stroke_width: 5.,
                    dash: None,
                    round: true,
                    scales: false,
                    id,
                });
                ((a.0 + b.0) / 2., (a.1 + b.1) / 2.)
            }
            _ => {
                if points.is_empty() {
                    return Err("Empty highlight".into());
                }
                let mut prim = polygon(&points, view, c, 0.42, id);
                if let Prim::Path { stroke_width, .. } = &mut prim {
                    *stroke_width = 1.;
                }
                prims.push(prim);
                let projected: Vec<_> = points.iter().map(|p| xy(*p, view)).collect();
                let n = projected.len() as f64;
                (
                    projected.iter().map(|p| p.0).sum::<f64>() / n,
                    projected.iter().map(|p| p.1).sum::<f64>() / n,
                )
            }
        };
        if let Some(label) = highlight["label"].as_str().filter(|s| !s.is_empty()) {
            prims.push(Prim::Text {
                at: (label_at.0 + 8., label_at.1 - 8.),
                text: label.into(),
                style: TextStyle::Highlight,
            });
        }
    }
    // Fitted frame: bounds are measured at zoom 1 and the frame recenters
    // on the zoomed bounds center, exactly as the web does.
    let base = View { zoom: 1., ..view };
    let (mut min_x, mut max_x, mut min_y, mut max_y) = (CENTER_X, CENTER_X, CENTER_Y, CENTER_Y);
    let mut include = |p: Point3| {
        let (x, y) = xy(p, base);
        if x.is_finite() && y.is_finite() {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
    };
    for m in &meshes {
        for p in m.triangles.iter().flatten() {
            include(*p);
        }
    }
    if axes {
        for (_, end, _) in axis_ends {
            include(end);
        }
    }
    let margin = 20.;
    let mut text_scale = 1.;
    if min_x < margin || max_x > WIDTH - margin || min_y < margin || max_y > HEIGHT - margin {
        let fit = f64::min(
            1.,
            f64::min(
                (WIDTH - margin * 2.) / f64::max(1., max_x - min_x),
                (HEIGHT - margin * 2.) / f64::max(1., max_y - min_y),
            ),
        );
        let cx = CENTER_X + ((min_x + max_x) / 2. - CENTER_X) * view.zoom;
        let cy = CENTER_Y + ((min_y + max_y) / 2. - CENTER_Y) * view.zoom;
        let map = |(x, y): (f64, f64)| (WIDTH / 2. + (x - cx) * fit, HEIGHT / 2. + (y - cy) * fit);
        for prim in &mut prims {
            match prim {
                Prim::Path {
                    points,
                    stroke_width,
                    scales,
                    ..
                } => {
                    for p in points.iter_mut() {
                        *p = map(*p);
                    }
                    if *scales {
                        *stroke_width *= fit;
                    }
                }
                Prim::Circle { center, radius, .. } => {
                    *center = map(*center);
                    *radius *= fit;
                }
                Prim::Text { at, .. } => *at = map(*at),
            }
        }
        text_scale = fit;
    }
    Ok(Drawing { prims, text_scale })
}

/// Load-time validation: every object and section must be renderable.
pub fn validate(content: &Value, variables: &Variables) -> Result<(), String> {
    render(content, View::initial(content), variables).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paraboloid(axis: &str, value: f64) -> Value {
        json!({
            "axes": true,
            "camera": {"yaw": 0.72, "pitch": 0.55, "zoom": 1},
            "objects": [{"id": "s", "kind": "surface", "color": "teal", "expression": "x^2 + y^2",
                "x_range": {"min": -2, "max": 2}, "y_range": {"min": -2, "max": 2}, "samples": 12}],
            "sections": [{"id": "sec", "axis": axis, "value": value, "targets": ["s"],
                "display": "plane_and_intersection", "color": "orange"}]
        })
    }

    #[test]
    fn projection_matches_the_web_formula() {
        let view = View {
            yaw: 0.72,
            pitch: 0.55,
            zoom: 1.,
        };
        let (x, y, d) = project(p3(1., 2., 3.), view, SCALE);
        let (sy, cy) = 0.72f64.sin_cos();
        let (sp, cp) = 0.55f64.sin_cos();
        let h = cy * 1. - sy * 2.;
        let dbp = sy * 1. + cy * 2.;
        assert!((x - (210. + h * 54.)).abs() < 1e-9);
        assert!((y - (143. - (cp * 3. - sp * dbp) * 54.)).abs() < 1e-9);
        assert!((d - (sp * 3. + cp * dbp)).abs() < 1e-9);
    }

    #[test]
    fn view_normalization_clamps_pitch_and_zoom() {
        let v = View {
            yaw: f64::NAN,
            pitch: 9.,
            zoom: 0.01,
        }
        .normalized();
        assert_eq!(v.yaw, 0.);
        assert_eq!(v.pitch, std::f64::consts::FRAC_PI_2);
        assert_eq!(v.zoom, 0.2);
        assert_eq!(View::initial(&json!({})).yaw, 0.65);
    }

    #[test]
    fn horizontal_section_of_a_paraboloid_is_one_closed_ring_on_the_level() {
        let content = paraboloid("z", 1.);
        let meshes = meshes(&content, &Variables::new()).unwrap();
        let paths = intersections(&meshes, &content["sections"][0]);
        assert_eq!(paths.len(), 1);
        let (_, solid, closed, points) = &paths[0];
        assert!(!solid && *closed);
        assert!(points.len() >= 8);
        for p in points {
            assert!((p.z - 1.).abs() < 1e-9);
            // Piecewise-linear mesh: the ring stays near radius 1.
            let r = (p.x * p.x + p.y * p.y).sqrt();
            assert!((0.9..=1.05).contains(&r), "r = {r}");
        }
    }

    #[test]
    fn vertical_section_through_grid_line_is_one_open_parabola() {
        // y = 0 hits a grid line exactly (12 samples over [-2, 2]).
        let content = paraboloid("y", 0.);
        let meshes = meshes(&content, &Variables::new()).unwrap();
        let paths = intersections(&meshes, &content["sections"][0]);
        assert_eq!(paths.len(), 1);
        let (_, _, closed, points) = &paths[0];
        assert!(!closed);
        assert_eq!(points.len(), 13);
        let xs: Vec<f64> = points.iter().map(|p| p.x).collect();
        assert!((xs[0].abs() - 2.).abs() < 1e-9 && (xs[12].abs() - 2.).abs() < 1e-9);
    }

    #[test]
    fn render_paints_axes_cells_plane_then_intersection_in_the_fitted_frame() {
        let content = paraboloid("z", 1.);
        let d = render(&content, View::initial(&content), &Variables::new()).unwrap();
        // 3 axes x (line + label), 144 cells, plane, ring.
        assert_eq!(d.prims.len(), 6 + 144 + 2);
        assert!(d.text_scale < 1.);
        let Prim::Path { dash, fill, .. } = &d.prims[150] else {
            panic!()
        };
        assert_eq!(*dash, Some((5., 4.)));
        assert_eq!(*fill, Some((0xffa500, 0.12)));
        let Prim::Path {
            closed,
            stroke_width,
            ..
        } = &d.prims[151]
        else {
            panic!()
        };
        assert!(*closed);
        assert_eq!(*stroke_width, 3.6);
        for prim in &d.prims {
            if let Prim::Path { points, .. } = prim {
                for (x, y) in points {
                    assert!((0. ..=WIDTH).contains(x) && (0. ..=HEIGHT).contains(y));
                }
            }
        }
    }

    #[test]
    fn unknown_objects_are_rejected() {
        let content = json!({"objects": [{"id": "t", "kind": "torus"}]});
        assert!(validate(&content, &Variables::new()).is_err());
    }
}
