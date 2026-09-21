//! Renderer-independent semantic placement and teaching-camera geometry.
//! This slice handles a single canonical region with measured node sizes.
//! Host reading lanes, obstacles and attachments remain outside this API.
use crate::preview::Preview;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub fn union(rects: &[Self], padding: f64) -> Option<Self> {
        if rects.is_empty() {
            return None;
        }
        let x = rects.iter().map(|r| r.x).fold(f64::INFINITY, f64::min);
        let y = rects.iter().map(|r| r.y).fold(f64::INFINITY, f64::min);
        let right = rects
            .iter()
            .map(|r| r.x + r.width)
            .fold(f64::NEG_INFINITY, f64::max);
        let bottom = rects
            .iter()
            .map(|r| r.y + r.height)
            .fold(f64::NEG_INFINITY, f64::max);
        Some(Self {
            x: x - padding,
            y: y - padding,
            width: right - x + padding * 2.,
            height: bottom - y + padding * 2.,
        })
    }
    fn intersects(self, b: Self) -> bool {
        self.x < b.x + b.width + 12.
            && self.x + self.width + 12. > b.x
            && self.y < b.y + b.height + 12.
            && self.y + self.height + 12. > b.y
    }
}
#[derive(Clone, Debug, Default)]
pub struct BoardLayout {
    pub nodes: BTreeMap<String, Rect>,
    pub groups: BTreeMap<String, Rect>,
    pub bounds: Rect,
}
fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn members(v: &Value) -> impl Iterator<Item = &str> {
    v["members"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}
fn group_rect(
    id: &str,
    p: &Preview,
    nodes: &BTreeMap<String, Rect>,
    seen: &mut BTreeSet<String>,
) -> Option<Rect> {
    if let Some(r) = nodes.get(id) {
        return Some(*r);
    }
    if !seen.insert(id.into()) {
        return None;
    }
    let group = p.groups.iter().find(|g| g["id"] == id)?;
    let rects = members(group)
        .map(|m| group_rect(m, p, nodes, &mut seen.clone()))
        .collect::<Option<Vec<_>>>()?;
    Rect::union(&rects, 34.)
}
fn contains(group: &Value, id: &str, p: &Preview, seen: &mut BTreeSet<String>) -> bool {
    if !seen.insert(string(group, "id").into()) {
        return false;
    }
    members(group).any(|m| {
        m == id
            || p.groups
                .iter()
                .find(|g| g["id"] == m)
                .is_some_and(|g| contains(g, id, p, seen))
    })
}
pub fn layout(p: &Preview, sizes: &BTreeMap<String, (f64, f64)>) -> Result<BoardLayout, String> {
    let regions = p
        .nodes
        .iter()
        .map(|n| n["region_id"].as_str().unwrap_or("__legacy__"))
        .collect::<BTreeSet<_>>();
    if regions.len() > 1 {
        return Err("Spatial preview does not yet support multiple course regions".into());
    }
    let mut result = BoardLayout::default();
    let (mut index, mut row_y, mut row_height, mut first_width) = (0, 90.0_f64, 0.0_f64, 0.0_f64);
    for node in &p.nodes {
        let id = string(node, "id");
        let &(width, height) = sizes
            .get(id)
            .ok_or_else(|| format!("Missing measured size {id}"))?;
        if !width.is_finite() || !height.is_finite() || width <= 0. || height <= 0. {
            return Err("Invalid measured size".into());
        }
        let placement = &node["placement"];
        let relation = placement["relation"].as_str().unwrap_or("new_region");
        let anchor = placement["anchor"]
            .as_str()
            .and_then(|id| group_rect(id, p, &result.nodes, &mut BTreeSet::new()));
        if placement["anchor"].is_string() && anchor.is_none() {
            return Err("Unresolved placement anchor".into());
        }
        let gap = match string(placement, "gap") {
            "compact" => 28.,
            "spacious" => 88.,
            _ => 54.,
        };
        let (mut x, mut y) = (100., 90.);
        if anchor.is_none() || relation == "new_region" {
            if index % 2 == 0 && index > 0 {
                row_y += row_height + 88.;
                row_height = 0.;
                first_width = 0.;
            }
            x = if index % 2 == 0 {
                100.
            } else {
                100. + first_width + 54.
            };
            y = row_y;
            if index % 2 == 0 {
                first_width = width;
            }
            row_height = row_height.max(height);
            index += 1;
        } else if let Some(a) = anchor {
            match relation {
                "below" => {
                    x = a.x;
                    y = a.y + a.height + gap;
                }
                "above" => {
                    x = a.x;
                    y = a.y - height - gap;
                }
                "right_of" => {
                    x = a.x + a.width + gap;
                    y = a.y + (a.height - height) / 2.;
                }
                "left_of" => {
                    x = a.x - width - gap;
                    y = a.y + (a.height - height) / 2.;
                }
                "near" => {
                    x = a.x + a.width + 28.;
                    y = a.y + 28.;
                }
                "inside" | "overlay" => {
                    x = a.x + 24.;
                    y = a.y + 24.;
                }
                _ => return Err(format!("Unsupported placement relation {relation}")),
            }
            if matches!(relation, "below" | "above") {
                match string(placement, "align") {
                    "center" => x = a.x + (a.width - width) / 2.,
                    "end" => x = a.x + a.width - width,
                    _ => (),
                }
            }
            if relation == "below" && y + height > 90. + 1150. && !result.nodes.is_empty() {
                x = result
                    .nodes
                    .values()
                    .map(|r| r.x + r.width)
                    .fold(f64::NEG_INFINITY, f64::max)
                    + 88.;
                y = 90.;
            }
        }
        let mut rect = Rect {
            x,
            y,
            width,
            height,
        };
        if !matches!(relation, "inside" | "overlay") {
            let mut obstacles = result.nodes.values().copied().collect::<Vec<_>>();
            for g in &p.groups {
                if !contains(g, id, p, &mut BTreeSet::new()) {
                    if let Some(r) =
                        group_rect(string(g, "id"), p, &result.nodes, &mut BTreeSet::new())
                    {
                        obstacles.push(r);
                    }
                }
            }
            let mut guard = 0;
            while obstacles.iter().any(|r| rect.intersects(*r)) {
                if guard == 40 {
                    return Err("Spatial collision could not be resolved".into());
                }
                rect.y += 36.;
                guard += 1;
            }
        }
        result.nodes.insert(id.into(), rect);
        if relation != "new_region"
            && anchor.is_some()
            && rect.y < row_y + row_height
            && rect.y + height > row_y
        {
            row_height = row_height.max(rect.y + height - row_y);
            if matches!(relation, "right_of" | "left_of" | "near") {
                index = index.max(2);
            }
        }
    }
    for g in &p.groups {
        if let Some(r) = group_rect(string(g, "id"), p, &result.nodes, &mut BTreeSet::new()) {
            result.groups.insert(string(g, "id").into(), r);
        }
    }
    let all = result
        .nodes
        .values()
        .chain(result.groups.values())
        .copied()
        .collect::<Vec<_>>();
    let raw = Rect::union(&all, 100.).unwrap_or(Rect {
        x: 0.,
        y: 0.,
        width: 1200.,
        height: 800.,
    });
    let dx = (20. - raw.x).max(0.);
    let dy = (20. - raw.y).max(0.);
    for r in result.nodes.values_mut().chain(result.groups.values_mut()) {
        r.x += dx;
        r.y += dy;
    }
    result.bounds = Rect {
        x: raw.x + dx,
        y: raw.y + dy,
        ..raw
    };
    Ok(result)
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}
impl Default for Camera {
    fn default() -> Self {
        Self {
            x: 0.,
            y: 0.,
            scale: 1.,
        }
    }
}
impl Camera {
    pub fn world_to_view(self, x: f64, y: f64) -> (f64, f64) {
        (self.x + x * self.scale, self.y + y * self.scale)
    }
    pub fn view_to_world(self, x: f64, y: f64) -> (f64, f64) {
        ((x - self.x) / self.scale, (y - self.y) / self.scale)
    }
    pub fn zoom_at(self, factor: f64, x: f64, y: f64) -> Self {
        let (wx, wy) = self.view_to_world(x, y);
        let scale = (self.scale * factor).clamp(0.18, 2.5);
        Self {
            x: x - wx * scale,
            y: y - wy * scale,
            scale,
        }
    }
    pub fn interpolate(self, to: Self, t: f64) -> Self {
        if t <= 0. {
            return self;
        }
        if t >= 1. {
            return to;
        }
        // Web .world uses cubic-bezier(.22,1,.36,1). Invert the x curve
        // before evaluating y, so supplied t remains elapsed-time progress.
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..40 {
            let u = (lo + hi) / 2.;
            let x = 3. * (1. - u) * (1. - u) * u * 0.22 + 3. * (1. - u) * u * u * 0.36 + u * u * u;
            if x < t {
                lo = u;
            } else {
                hi = u;
            }
        }
        let u = (lo + hi) / 2.;
        let t = 1. - (1. - u).powi(3);
        Self {
            x: self.x + (to.x - self.x) * t,
            y: self.y + (to.y - self.y) * t,
            scale: self.scale + (to.scale - self.scale) * t,
        }
    }
}
/// The existing Web camera formula, with no overlay UI/insets (host owns viewport).
pub fn focus_camera(
    targets: &[Rect],
    current: Camera,
    width: f64,
    height: f64,
    mode: &str,
) -> Camera {
    let Some(scene) = Rect::union(targets, 0.) else {
        return current;
    };
    let sw = (width - 140.).max(1.);
    let sh = (height - 140.).max(1.);
    let fit = (sw / scene.width.max(1.))
        .min(sh / scene.height.max(1.))
        .clamp(0.18, 1.3);
    let composition = match mode {
        "relationship" => 0.85,
        "overview" => 0.88,
        "course" => 1.,
        _ => 0.78,
    };
    let extent = (scene.width / sw).max(scene.height / sh);
    let readable = targets
        .iter()
        .map(|r| 240. / r.width.max(1.))
        .fold(0., f64::max);
    let scale = fit.min(0.18_f64.max(readable).max(composition / extent.max(0.001)));
    Camera {
        x: 70. + sw / 2. - (scene.x + scene.width / 2.) * scale,
        y: 70. + sh / 2. - (scene.y + scene.height / 2.) * scale,
        scale,
    }
}

/// Match Web variableAnimationFocusTargets: both bindings and plot expressions
/// can depend on a variable; identifier boundaries avoid x matching max/xx.
pub fn variable_targets(p: &Preview, variable: &str) -> Vec<String> {
    if variable.is_empty() {
        return Vec::new();
    }
    let pattern = regex::Regex::new(&format!(
        r"(?i)(^|[^a-z0-9_]){}([^a-z0-9_]|$)",
        regex::escape(variable)
    ))
    .expect("escaped variable regex");
    p.nodes
        .iter()
        .filter(|n| {
            let keys = if n["kind"] == "plot" {
                &["bindings", "curves"][..]
            } else {
                &["bindings"][..]
            };
            keys.iter().any(|k| {
                n["content"][k].as_array().into_iter().flatten().any(|b| {
                    b["expression"]
                        .as_str()
                        .is_some_and(|s| pattern.is_match(s))
                })
            })
        })
        .filter_map(|n| n["id"].as_str().map(str::to_owned))
        .collect()
}
