//! Renderer-independent semantic placement and teaching-camera geometry.
//! Supports semantic/reading regions, host obstacles and anchored controls.
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
    pub attachments: BTreeMap<String, Rect>,
    pub regions: BTreeMap<String, Rect>,
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

fn region(n: &Value) -> &str {
    n["region_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("__legacy__")
}
fn visual(n: &Value) -> bool {
    matches!(
        string(n, "kind"),
        "geometry" | "scene3d" | "plot" | "image" | "diagram"
    )
}
fn endpoint(t: &Value) -> &str {
    t.as_str()
        .or(t["node_id"].as_str())
        .or(t["group_id"].as_str())
        .or(t["connection_id"].as_str())
        .unwrap_or("")
}
// Stable topological ordering; cycles retain authored order like the Web layout.
fn topo(items: &[usize], edges: &[(usize, usize)]) -> Vec<usize> {
    let mut pending = items.to_vec();
    pending.sort_unstable();
    let mut out = vec![];
    loop {
        let next = pending
            .iter()
            .position(|id| !edges.iter().any(|(a, b)| b == id && pending.contains(a)));
        let Some(at) = next else { break };
        out.push(pending.remove(at));
    }
    out.extend(pending);
    out
}
fn ordered(p: &Preview) -> Vec<usize> {
    let index = |id: &str| p.nodes.iter().position(|n| n["id"] == id);
    let mut edges = vec![];
    let mut adjacent = vec![vec![]; p.nodes.len()];
    let mut relate = |a: &str, b: &str| {
        if let (Some(a), Some(b)) = (index(a), index(b)) {
            if region(&p.nodes[a]) == region(&p.nodes[b]) {
                edges.push((a, b));
                if visual(&p.nodes[a]) && visual(&p.nodes[b]) {
                    adjacent[a].push(b);
                    adjacent[b].push(a);
                }
            }
        }
    };
    for node in &p.nodes {
        relate(string(&node["placement"], "anchor"), string(node, "id"));
    }
    for c in &p.connections {
        relate(endpoint(&c["from"]), endpoint(&c["to"]));
    }
    let mut seen = BTreeSet::new();
    let mut components: Vec<Vec<usize>> = vec![];
    for i in 0..p.nodes.len() {
        if !seen.insert(i) {
            continue;
        }
        let mut component = vec![i];
        let mut at = 0;
        while at < component.len() {
            for &j in &adjacent[component[at]] {
                if seen.insert(j) {
                    component.push(j);
                }
            }
            at += 1;
        }
        components.push(component);
    }
    let component_of = |i| components.iter().position(|c| c.contains(&i)).unwrap();
    let component_edges = edges
        .iter()
        .filter_map(|&(a, b)| {
            let a = component_of(a);
            let b = component_of(b);
            (a != b).then_some((a, b))
        })
        .collect::<Vec<_>>();
    topo(&(0..components.len()).collect::<Vec<_>>(), &component_edges)
        .into_iter()
        .flat_map(|i| topo(&components[i], &edges))
        .collect()
}
#[derive(Default)]
struct Cursor {
    x: f64,
    y: f64,
    reserved: f64,
    index: usize,
    row_y: f64,
    row_height: f64,
    first_width: f64,
    visual_bottom: Option<f64>,
    narrative_bottom: Option<f64>,
    narrative_x: Option<f64>,
    narrative_width: f64,
    narrative_items: usize,
}
fn host_rect(v: &Value) -> Result<Rect, String> {
    let get = |k: &str| {
        v[k].as_f64()
            .filter(|n| n.is_finite())
            .ok_or_else(|| format!("Invalid host rectangle {k}"))
    };
    let r = Rect {
        x: get("x")?,
        y: get("y")?,
        width: get("width")?,
        height: get("height")?,
    };
    if r.width < 0. || r.height < 0. {
        return Err("Negative host rectangle".into());
    }
    Ok(r)
}
fn obstacles(p: &Preview, n: &Value, result: &BoardLayout, external: &[Rect]) -> Vec<Rect> {
    let mut out = result
        .nodes
        .values()
        .chain(result.attachments.values())
        .copied()
        .collect::<Vec<_>>();
    out.extend(external);
    for g in &p.groups {
        if !contains(g, string(n, "id"), p, &mut BTreeSet::new()) {
            if let Some(r) = group_rect(string(g, "id"), p, &result.nodes, &mut BTreeSet::new()) {
                out.push(r);
            }
        }
    }
    out
}
pub fn layout(p: &Preview, sizes: &BTreeMap<String, (f64, f64)>) -> Result<BoardLayout, String> {
    layout_with_options(p, sizes, &Value::Null)
}
/// Host constraints follow the existing Web regions/options shape. Core never measures widgets.
pub fn layout_with_options(
    p: &Preview,
    sizes: &BTreeMap<String, (f64, f64)>,
    options: &Value,
) -> Result<BoardLayout, String> {
    let mut result = BoardLayout::default();
    let mut cursors: BTreeMap<String, Cursor> = BTreeMap::new();
    let mut attachment_regions = BTreeMap::new();
    for i in ordered(p) {
        let node = &p.nodes[i];
        let id = string(node, "id");
        let region_id = region(node);
        let constraint = &options["regions"][region_id];
        let &(mut width, height) = sizes
            .get(id)
            .ok_or_else(|| format!("Missing measured size {id}"))?;
        if !width.is_finite() || !height.is_finite() || width <= 0. || height <= 0. {
            return Err("Invalid measured size".into());
        }
        let placement = &node["placement"];
        let relation = placement["relation"].as_str().unwrap_or("new_region");
        let anchor_id = string(placement, "anchor");
        let anchor = if anchor_id.is_empty() {
            None
        } else {
            group_rect(anchor_id, p, &result.nodes, &mut BTreeSet::new())
        };
        if !anchor_id.is_empty() && anchor.is_none() {
            return Err("Unresolved placement anchor".into());
        }
        let gap = match string(placement, "gap") {
            "compact" => 28.,
            "spacious" => 88.,
            _ => 54.,
        };
        let external = constraint["obstacles"]
            .as_array()
            .into_iter()
            .flatten()
            .map(host_rect)
            .collect::<Result<Vec<_>, _>>()?;
        let connected = p.connections.iter().find_map(|c| {
            let a = endpoint(&c["from"]);
            let b = endpoint(&c["to"]);
            let peer = if a == id {
                b
            } else if b == id {
                a
            } else {
                return None;
            };
            let n = p
                .nodes
                .iter()
                .find(|n| n["id"] == peer && region(n) == region_id)?;
            Some((n, *result.nodes.get(peer)?))
        });
        let anchor_node = p.nodes.iter().find(|n| n["id"] == anchor_id);
        let anchor_group = p.groups.iter().find(|g| g["id"] == anchor_id);
        let attached_group = !visual(node)
            && relation == "below"
            && anchor_group.is_some_and(|g| {
                constraint["attachments"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|a| {
                        let ids = a["anchorNodeIds"]
                            .as_array()
                            .filter(|a| !a.is_empty())
                            .cloned()
                            .unwrap_or_else(|| vec![a["anchorNodeId"].clone()]);
                        ids.iter().any(|id| {
                            contains(g, id.as_str().unwrap_or(""), p, &mut BTreeSet::new())
                        })
                    })
            });
        let authored = (anchor.is_some()
            && ((anchor_group.is_some() && !attached_group)
                || (visual(node) && anchor_node.is_some_and(visual))))
            || connected.is_some_and(|(n, _)| visual(node) && visual(n));
        let reading = constraint["flow"] == "reading"
            && !matches!(relation, "inside" | "overlay")
            && !authored;
        let needs_cursor = reading || anchor.is_none() || relation == "new_region";
        if needs_cursor && !cursors.contains_key(region_id) {
            let occupied = obstacles(p, node, &result, &external);
            let right = occupied
                .iter()
                .map(|r| r.x + r.width)
                .chain(cursors.values().map(|c| c.x + c.reserved))
                .fold(-80., f64::max);
            let x = constraint["x"].as_f64().unwrap_or(if cursors.is_empty() {
                100.
            } else {
                right + 180.
            });
            let y = constraint["y"].as_f64().unwrap_or(90.);
            if !x.is_finite() || !y.is_finite() {
                return Err("Invalid host region origin".into());
            }
            cursors.insert(
                region_id.into(),
                Cursor {
                    x,
                    y,
                    row_y: y,
                    reserved: constraint["reservedWidth"].as_f64().unwrap_or(0.).max(0.),
                    ..Default::default()
                },
            );
        }
        let (mut x, mut y) = (100., 90.);
        if reading {
            let c = cursors.get_mut(region_id).unwrap();
            if visual(node) {
                x = c.x;
                y = c.visual_bottom.map(|y| y + 54.).unwrap_or(c.y);
            } else {
                let visual_width = p
                    .nodes
                    .iter()
                    .filter(|n| {
                        region(n) == region_id
                            && visual(n)
                            && !matches!(string(&n["placement"], "relation"), "inside" | "overlay")
                    })
                    .filter_map(|n| sizes.get(string(n, "id")).map(|s| s.0))
                    .reduce(f64::max);
                let right = result
                    .nodes
                    .iter()
                    .filter(|(id, _)| {
                        p.nodes
                            .iter()
                            .any(|n| n["id"] == id.as_str() && region(n) == region_id && visual(n))
                    })
                    .map(|(_, r)| r.x + r.width)
                    .fold(c.x + visual_width.unwrap_or(0.), f64::max);
                x = c.narrative_x.unwrap_or(if visual_width.is_some() {
                    right + 54.
                } else {
                    c.x
                });
                c.narrative_x = Some(x);
                let next_y = c.narrative_bottom.map(|y| y + 28.).unwrap_or(c.y);
                if c.narrative_bottom.is_some()
                    && (c.narrative_items >= 4 || next_y + height > c.y + 760.)
                {
                    x += c.narrative_width.max(280.) + 54.;
                    c.narrative_x = Some(x);
                    c.narrative_bottom = None;
                    c.narrative_width = 0.;
                    c.narrative_items = 0;
                }
                let available = (c.reserved - (x - c.x)).max(0.);
                if available >= 280. {
                    width = width.min(available);
                }
                y = c.narrative_bottom.map(|y| y + 28.).unwrap_or(c.y);
            }
        } else if anchor.is_none() || relation == "new_region" {
            let c = cursors.get_mut(region_id).unwrap();
            if let Some((_, r)) = connected.filter(|(n, _)| visual(node) && visual(n)) {
                x = r.x + r.width + 54.;
                y = r.y + (r.height - height) / 2.;
                c.row_height = c.row_height.max(height + (y - c.row_y).max(0.));
                c.index = (c.index + 1).max(2);
            } else {
                if c.index % 2 == 0 && c.index > 0 {
                    c.row_y += c.row_height + 88.;
                    c.row_height = 0.;
                    c.first_width = 0.;
                }
                x = if c.index % 2 == 0 {
                    c.x
                } else {
                    c.x + c.first_width + 54.
                };
                y = c.row_y;
                if c.index % 2 == 0 {
                    c.first_width = width;
                }
                c.row_height = c.row_height.max(height);
                c.index += 1;
            }
        } else if let Some(a) = anchor {
            match relation {
                "below" => {
                    x = a.x;
                    y = a.y + a.height + gap
                }
                "above" => {
                    x = a.x;
                    y = a.y - height - gap
                }
                "right_of" => {
                    x = a.x + a.width + gap;
                    y = a.y + (a.height - height) / 2.
                }
                "left_of" => {
                    x = a.x - width - gap;
                    y = a.y + (a.height - height) / 2.
                }
                "near" => {
                    x = a.x + a.width + 28.;
                    y = a.y + 28.
                }
                "inside" | "overlay" => {
                    x = a.x + 24.;
                    y = a.y + 24.
                }
                _ => return Err(format!("Unsupported relation {relation}")),
            };
            if matches!(relation, "below" | "above") {
                match string(placement, "align") {
                    "center" => x = a.x + (a.width - width) / 2.,
                    "end" => x = a.x + a.width - width,
                    _ => (),
                }
            }
        }
        if let Some(a) = anchor {
            if relation == "below" {
                let same = result
                    .nodes
                    .iter()
                    .filter(|(id, _)| {
                        p.nodes
                            .iter()
                            .any(|n| n["id"] == id.as_str() && region(n) == region_id)
                    })
                    .map(|(_, r)| *r)
                    .collect::<Vec<_>>();
                let top = constraint["y"]
                    .as_f64()
                    .or(cursors.get(region_id).map(|c| c.y))
                    .unwrap_or(same.iter().map(|r| r.y).fold(a.y, f64::min));
                if y + height > top + 1150. && !same.is_empty() {
                    x = same
                        .iter()
                        .map(|r| r.x + r.width)
                        .fold(f64::NEG_INFINITY, f64::max)
                        + 88.;
                    y = top;
                    if reading && !visual(node) {
                        cursors.get_mut(region_id).unwrap().narrative_x = Some(x);
                    }
                }
            }
        }
        let mut r = Rect {
            x,
            y,
            width,
            height,
        };
        if !matches!(relation, "inside" | "overlay") {
            let right = external
                .iter()
                .filter(|o| r.intersects(**o))
                .map(|o| o.x + o.width)
                .reduce(f64::max);
            if let Some(right) = right {
                r.x = r.x.max(right) + 28.;
            }
            let occupied = obstacles(p, node, &result, &external);
            let mut count = 0;
            while occupied.iter().any(|o| r.intersects(*o)) {
                if count == 40 {
                    return Err("Spatial collision could not be resolved".into());
                }
                r.y += 36.;
                count += 1;
            }
        }
        result.nodes.insert(id.into(), r);
        let mut bottom = r.y + r.height;
        if let Some(regions) = options["regions"].as_object() {
            for (attachment_region, options) in regions {
                for a in options["attachments"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|a| a["anchorNodeId"] == id)
                {
                    let ids = a["anchorNodeIds"]
                        .as_array()
                        .filter(|ids| !ids.is_empty())
                        .cloned()
                        .unwrap_or_else(|| vec![a["anchorNodeId"].clone()]);
                    let anchors = ids
                        .iter()
                        .filter_map(|id| result.nodes.get(id.as_str().unwrap_or("")).copied())
                        .collect::<Vec<_>>();
                    let anchor = Rect::union(&anchors, 0.).unwrap_or(r);
                    let width = a["width"]
                        .as_f64()
                        .ok_or("Invalid attachment width")?
                        .max(1.);
                    let height = a["height"]
                        .as_f64()
                        .ok_or("Invalid attachment height")?
                        .max(1.);
                    let gap = a["gap"].as_f64().unwrap_or(42.).max(12.);
                    let left = options["x"]
                        .as_f64()
                        .or(if reading {
                            cursors.get(region_id).map(|c| c.x)
                        } else {
                            None
                        })
                        .unwrap_or(anchor.x);
                    let reserved = options["reservedWidth"].as_f64().unwrap_or(0.).max(0.);
                    let max_x = if reserved > 0. {
                        left.max(left + reserved - width)
                    } else {
                        anchor.x
                    };
                    let mut ar = Rect {
                        x: left.max(anchor.x).min(max_x),
                        y: anchor.y + anchor.height + gap,
                        width,
                        height,
                    };
                    let occupied = obstacles(p, node, &result, &external);
                    let mut count = 0;
                    while occupied.iter().any(|o| ar.intersects(*o)) {
                        if count == 80 {
                            return Err("Attachment collision could not be resolved".into());
                        }
                        ar.y += 36.;
                        count += 1;
                    }
                    let aid = string(a, "id");
                    if aid.is_empty() {
                        return Err("Missing attachment id".into());
                    }
                    result.attachments.insert(aid.into(), ar);
                    attachment_regions.insert(aid.to_owned(), attachment_region.to_owned());
                    bottom = bottom.max(ar.y + ar.height);
                }
            }
        }
        if let Some(c) = cursors.get_mut(region_id) {
            if reading {
                if visual(node) {
                    c.visual_bottom = Some(bottom);
                } else {
                    c.narrative_bottom = Some(bottom);
                    c.narrative_width = c.narrative_width.max(r.width);
                    c.narrative_items += 1;
                }
            }
            if relation != "new_region"
                && anchor.is_some()
                && r.y < c.row_y + c.row_height
                && r.y + r.height > c.row_y
            {
                c.row_height = c.row_height.max(r.y + r.height - c.row_y);
                if matches!(relation, "right_of" | "left_of" | "near") {
                    c.index = c.index.max(2);
                }
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
        .chain(result.attachments.values())
        .copied()
        .collect::<Vec<_>>();
    let raw = Rect::union(&all, 100.).unwrap_or(Rect {
        x: 0.,
        y: 0.,
        width: 1200.,
        height: 800.,
    });
    let host = options["regions"]
        .as_object()
        .is_some_and(|o| !o.is_empty());
    let dx = if host { 0. } else { (20. - raw.x).max(0.) };
    let dy = if host { 0. } else { (20. - raw.y).max(0.) };
    for r in result
        .nodes
        .values_mut()
        .chain(result.groups.values_mut())
        .chain(result.attachments.values_mut())
    {
        r.x += dx;
        r.y += dy;
    }
    result.bounds = Rect {
        x: raw.x + dx,
        y: raw.y + dy,
        ..raw
    };
    let mut regions: BTreeMap<String, Vec<Rect>> = BTreeMap::new();
    for node in &p.nodes {
        if let Some(r) = result.nodes.get(string(node, "id")) {
            regions.entry(region(node).into()).or_default().push(*r);
        }
    }
    for g in &p.groups {
        let ids = p
            .nodes
            .iter()
            .filter(|n| contains(g, string(n, "id"), p, &mut BTreeSet::new()))
            .map(region)
            .collect::<BTreeSet<_>>();
        if ids.len() == 1 {
            if let Some(r) = result.groups.get(string(g, "id")) {
                regions
                    .entry(ids.into_iter().next().unwrap().into())
                    .or_default()
                    .push(*r);
            }
        }
    }
    for (id, r) in &result.attachments {
        regions
            .entry(attachment_regions[id].clone())
            .or_default()
            .push(*r);
    }
    result.regions = regions
        .into_iter()
        .filter_map(|(id, rs)| Rect::union(&rs, 0.).map(|r| (id, r)))
        .collect();
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
