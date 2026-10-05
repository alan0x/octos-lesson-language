//! Stage Rows x Step Columns teaching layout (阶段行 × 步骤列), ported from
//! packages/web-runtime/src/teaching-layout.ts (computeTeachingRegion).
//!
//! Hosts never pass explicit `relations`, so the relation-driven paths of the
//! Web layout (slots under a visual, cards beside the card they explain, and
//! spans below an explained pair) are inert there and are not ported; with no
//! relations the Web code takes exactly the branches implemented here.
//! Ink-pinned positions are not ported either: native ink does not pin cards.
use crate::preview::Preview;
use crate::spatial::Rect;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Gap between a visual and the variable controls docked under it.
const DOCK_GAP: f64 = 8.;
const CARD_GAP: f64 = 16.;
const WORKBENCH_GAP: f64 = 28.;
const SUBCOLUMN_GAP: f64 = 20.;
const STEP_GAP: f64 = 40.;
const STAGE_GAP: f64 = 72.;
const BAND_GAP: f64 = 36.;
const CONTROL_GAP: f64 = 24.;
const MIN_COLUMN_HEIGHT: f64 = 260.;
const MIN_WIDE_COLUMN: f64 = 300.;
const SAFE_MARGIN: f64 = 80.;
const READING_SCALE: f64 = 0.9;
/// A short step (at most this many cards) may continue under the previous step's column.
const STACK_STEP_MAX_CARDS: usize = 2;
/// How much a stacked step may widen the column it joins.
const STACK_WIDTH_RATIO: f64 = 1.7;
const DEFAULT_VISUAL_WIDTH: f64 = 460.;
const OBSTACLE_GAP: f64 = 28.;

fn default_height(kind: &str) -> f64 {
    match kind {
        "math" => 90.,
        "note" => 150.,
        "text" => 120.,
        _ => 120.,
    }
}
fn default_width(kind: &str) -> f64 {
    match kind {
        "math" => 320.,
        "note" => 330.,
        "text" => 320.,
        _ => 320.,
    }
}
pub(crate) fn is_visual(kind: &str) -> bool {
    matches!(kind, "geometry" | "scene3d" | "plot" | "image" | "diagram")
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AttachmentKind {
    #[default]
    Control,
    Task,
    /// A thinking-question card placed directly under its anchor card.
    Reflection,
}
/// Host attachment (web RegionLayoutConstraint.attachments[]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Attachment {
    pub id: String,
    pub kind: AttachmentKind,
    pub anchor_node_id: String,
    /// Display owner; only its teaching row reserves space for the attachment.
    pub owner_node_id: Option<String>,
    /// Dependency set (anchorNodeIds, or [anchorNodeId]).
    pub anchor_node_ids: Vec<String>,
    pub width: f64,
    pub height: f64,
}
impl Attachment {
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let anchor = v["anchorNodeId"].as_str().unwrap_or("").to_owned();
        let ids: Vec<String> = v["anchorNodeIds"]
            .as_array()
            .filter(|a| !a.is_empty())
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_else(|| vec![anchor.clone()]);
        Ok(Self {
            id: v["id"].as_str().ok_or("Missing attachment id")?.into(),
            kind: match v["kind"].as_str() {
                Some("task") => AttachmentKind::Task,
                Some("reflection") => AttachmentKind::Reflection,
                _ => AttachmentKind::Control,
            },
            anchor_node_id: anchor,
            owner_node_id: v["ownerNodeId"].as_str().map(str::to_owned),
            anchor_node_ids: ids,
            width: v["width"].as_f64().ok_or("Invalid attachment width")?,
            height: v["height"].as_f64().ok_or("Invalid attachment height")?,
        })
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Planned {
    pub visual: usize,
    pub math: usize,
    pub text: usize,
}
/// The composition inputs of a teaching region.
#[derive(Clone, Debug, Default)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    /// node id -> step id, in node creation order (web object key order).
    pub node_sections: Vec<(String, String)>,
    /// step id -> planned counts, in step order.
    pub planned_steps: Option<Vec<(String, Planned)>>,
    pub width: f64,
    pub height: f64,
    /// Viewport insets (top, right, bottom, left).
    pub insets: (f64, f64, f64, f64),
    /// Camera scale the host reads a teaching row at (web composition.readingScale).
    pub reading_scale: Option<f64>,
    pub attachments: Vec<Attachment>,
    pub obstacles: Vec<Rect>,
}
impl Region {
    /// Parse the Web RegionLayoutConstraint JSON shape (composition required).
    pub fn from_json(v: &Value) -> Result<Self, String> {
        let composition = &v["composition"];
        let insets = &composition["insets"];
        let inset = |k: &str| {
            insets[k]
                .as_f64()
                .filter(|n| n.is_finite())
                .unwrap_or(0.)
                .max(0.)
        };
        let pairs = |o: &Value| -> Vec<(String, Value)> {
            o.as_object()
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default()
        };
        Ok(Self {
            x: v["x"].as_f64().ok_or("Missing region x")?,
            y: v["y"].as_f64().ok_or("Missing region y")?,
            node_sections: pairs(&v["nodeSections"])
                .into_iter()
                .filter_map(|(k, s)| s.as_str().map(|s| (k, s.to_owned())))
                .collect(),
            planned_steps: v["plannedSteps"].is_object().then(|| {
                pairs(&v["plannedSteps"])
                    .into_iter()
                    .map(|(k, c)| {
                        let n = |f: &str| c[f].as_u64().unwrap_or(0) as usize;
                        (
                            k,
                            Planned {
                                visual: n("visual"),
                                math: n("math"),
                                text: n("text"),
                            },
                        )
                    })
                    .collect()
            }),
            width: composition["width"]
                .as_f64()
                .ok_or("Missing composition width")?,
            height: composition["height"]
                .as_f64()
                .ok_or("Missing composition height")?,
            insets: (inset("top"), inset("right"), inset("bottom"), inset("left")),
            reading_scale: composition["readingScale"].as_f64(),
            attachments: v["attachments"]
                .as_array()
                .into_iter()
                .flatten()
                .map(Attachment::from_json)
                .collect::<Result<_, _>>()?,
            obstacles: v["obstacles"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|r| Rect {
                    x: r["x"].as_f64().unwrap_or(0.),
                    y: r["y"].as_f64().unwrap_or(0.),
                    width: r["width"].as_f64().unwrap_or(0.),
                    height: r["height"].as_f64().unwrap_or(0.),
                })
                .collect(),
        })
    }
}

#[derive(Clone, Debug)]
struct Item {
    id: String,
    section: String,
    kind: String,
    visual: bool,
    w: f64,
    h: f64,
}
#[derive(Clone, Debug, Default)]
struct Cluster {
    /// Index of the stage (teaching row) that displays this cluster.
    stage: usize,
    visual_ids: Vec<String>,
    controls: Option<Attachment>,
    tasks: Option<Attachment>,
}
#[derive(Clone, Debug)]
struct Stage {
    open: String,
    sections: Vec<String>,
}

fn bounds(rects: &[Rect]) -> Rect {
    Rect::union(rects, 0.).unwrap_or_default()
}
fn overlaps(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width + 12.
        && a.x + a.width + 12. > b.x
        && a.y < b.y + b.height + 12.
        && a.y + a.height + 12. > b.y
}
fn max0<I: IntoIterator<Item = f64>>(it: I) -> f64 {
    it.into_iter().fold(0., f64::max)
}

/// Split ordered heights into k contiguous groups minimising the tallest group.
fn balanced_counts(heights: &[f64], k: usize) -> Vec<usize> {
    let n = heights.len();
    if k <= 1 || n <= 1 {
        return vec![n];
    }
    let mut prefix = vec![0.];
    for h in heights {
        prefix.push(prefix.last().unwrap() + h);
    }
    let cost = |i: usize, j: usize| prefix[j] - prefix[i] + CARD_GAP * (j as f64 - i as f64 - 1.);
    let mut best = vec![vec![f64::INFINITY; n + 1]; k + 1];
    let mut cut = vec![vec![0usize; n + 1]; k + 1];
    best[0][0] = 0.;
    for g in 1..=k {
        for j in 1..=n {
            for i in g - 1..j {
                let value = best[g - 1][i].max(cost(i, j));
                if value < best[g][j] {
                    best[g][j] = value;
                    cut[g][j] = i;
                }
            }
        }
    }
    let mut counts = Vec::new();
    let mut j = n;
    for g in (1..=k).rev() {
        let i = cut[g][j];
        counts.insert(0, j - i);
        j = i;
    }
    counts.into_iter().filter(|c| *c > 0).collect()
}

struct Plan {
    counts: Vec<usize>,
    index: usize,
    placed: Vec<usize>,
}
struct Column {
    x: f64,
    width: f64,
    ids: Vec<String>,
}

pub struct TeachingLayout {
    pub nodes: BTreeMap<String, Rect>,
    pub attachments: BTreeMap<String, Rect>,
}

struct Ctx<'a> {
    p: &'a Preview,
    items: Vec<Item>,
    planned: BTreeMap<String, Planned>,
    clusters: Vec<Cluster>,
    pairs: Vec<Vec<String>>,
    joiners: BTreeSet<String>,
    reading_width: f64,
    column_height: f64,
    nodes: BTreeMap<String, Rect>,
    attachments: BTreeMap<String, Rect>,
}
impl Ctx<'_> {
    fn node(&self, id: &str) -> Option<&Value> {
        self.p.nodes.iter().find(|n| n["id"] == id)
    }
    fn item(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }
    fn members(&self, id: &str, seen: &mut BTreeSet<String>) -> Vec<String> {
        if self.item(id).is_some() {
            return vec![id.into()];
        }
        if !seen.insert(id.into()) {
            return vec![];
        }
        let Some(group) = self.p.groups.iter().find(|g| g["id"] == id) else {
            return vec![];
        };
        group["members"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .flat_map(|m| self.members(m, seen))
            .collect()
    }
    fn paired(&self, a: &str, b: &str) -> bool {
        self.pairs
            .iter()
            .any(|p| p.iter().any(|x| x == a) && p.iter().any(|x| x == b))
    }
    fn planned_visuals(&self, section: &str) -> usize {
        let present = self
            .items
            .iter()
            .filter(|i| i.section == section && i.visual)
            .count();
        self.planned
            .get(section)
            .map_or(0, |p| p.visual)
            .max(present)
    }
    fn place(&mut self, id: &str, x: f64, y: f64, width: f64, height: f64) {
        self.nodes.insert(
            id.into(),
            Rect {
                x,
                y,
                width,
                height,
            },
        );
    }
    fn place_attachment(&mut self, spec: &Attachment, x: f64, y: f64) {
        self.attachments.insert(
            spec.id.clone(),
            Rect {
                x,
                y,
                width: spec.width,
                height: spec.height,
            },
        );
    }
    fn all_bottom(&self) -> f64 {
        max0(
            self.nodes
                .values()
                .chain(self.attachments.values())
                .map(|r| r.y + r.height),
        )
    }
    /// Size estimates come only from cards created before a step starts.
    fn estimate(&self, kind: &str, height: bool, before: usize) -> f64 {
        let seen: Vec<&Item> = self.items[..before]
            .iter()
            .filter(|i| !i.visual && i.kind == kind)
            .collect();
        if !seen.is_empty() {
            return seen
                .iter()
                .map(|i| if height { i.h } else { i.w })
                .sum::<f64>()
                / seen.len() as f64;
        }
        if height {
            default_height(kind)
        } else {
            default_width(kind)
        }
    }
}

/// Mutable column cursor of one wide stage (web wideStage closures).
struct Cursor {
    x: f64,
    col_top: f64,
    col_width: f64,
    col_y: f64,
    col_count: usize,
    col_ids: Vec<String>,
    /// Right edge of the current band.
    row_right: f64,
    /// The open column was reopened below earlier content (must not widen).
    reopened: bool,
    plan: Option<Plan>,
    columns: Vec<Column>,
    bottom: f64,
}
impl Cursor {
    fn close_column(&mut self) {
        if self.col_count > 0 {
            self.columns.push(Column {
                x: self.x,
                width: self.col_width,
                ids: self.col_ids.clone(),
            });
        }
        self.row_right = self.row_right.max(self.x + self.col_width);
    }
    fn open_column(&mut self, gap: f64) {
        if self.col_count > 0 {
            self.close_column();
            self.x = self.row_right + gap;
        }
        self.col_width = 0.;
        self.col_y = self.col_top;
        self.col_count = 0;
        self.col_ids.clear();
        self.reopened = false;
    }
    fn wrap_to_band(&mut self, all_bottom: f64) {
        self.close_column();
        self.col_top = self.bottom.max(all_bottom) + BAND_GAP;
        self.x = 0.;
        self.col_width = 0.;
        self.col_y = self.col_top;
        self.col_count = 0;
        self.col_ids.clear();
        self.row_right = 0.;
        self.reopened = false;
    }
    /// A card that does not fit to the right of the row continues under an
    /// earlier column of the same band when that column is wide enough and
    /// has room, instead of opening a new band below everything.
    fn reopen_column_for(&mut self, ctx: &Ctx, item: &Item) -> bool {
        for index in 0..self.columns.len() {
            let column = &self.columns[index];
            if item.w > column.width + 1. {
                continue;
            }
            let rects: Vec<Rect> = column.ids.iter().map(|id| ctx.nodes[id]).collect();
            if rects.iter().map(|r| r.y).fold(f64::INFINITY, f64::min) < self.col_top - 1. {
                continue;
            }
            let bottom = rects
                .iter()
                .map(|r| r.y + r.height)
                .fold(f64::NEG_INFINITY, f64::max);
            let last_section = column
                .ids
                .last()
                .and_then(|id| ctx.item(id))
                .map(|i| i.section.as_str());
            let gap_before = if last_section == Some(item.section.as_str()) {
                CARD_GAP
            } else {
                STEP_GAP
            };
            let probe = Rect {
                x: column.x,
                y: bottom + gap_before,
                width: column.width,
                height: item.h,
            };
            if probe.y + probe.height > self.col_top + ctx.column_height {
                continue;
            }
            let occupied = ctx
                .nodes
                .iter()
                .filter(|(id, _)| !column.ids.contains(id))
                .map(|(_, r)| r)
                .chain(ctx.attachments.values());
            if occupied.into_iter().any(|r| overlaps(probe, *r)) {
                continue;
            }
            self.close_column();
            let column = self.columns.remove(index);
            self.x = column.x;
            self.col_width = column.width;
            self.col_y = bottom + gap_before - CARD_GAP;
            self.col_count = column.ids.len();
            self.col_ids = column.ids;
            self.reopened = true;
            return true;
        }
        false
    }
    fn add_primary(&mut self, ctx: &mut Ctx, item: &Item) {
        let overflow =
            self.col_count > 0 && self.col_y + CARD_GAP + item.h > self.col_top + ctx.column_height;
        let plan_break = self.plan.as_ref().is_some_and(|p| {
            self.col_count > 0
                && p.placed[p.index] >= p.counts[p.index]
                && p.index < p.counts.len() - 1
        });
        if overflow || plan_break {
            self.open_column(SUBCOLUMN_GAP);
            if let Some(p) = &mut self.plan {
                p.index = (p.index + 1).min(p.counts.len() - 1);
            }
        }
        if self.col_count == 0
            && self.x > 0.
            && self.x + item.w > ctx.reading_width
            && !self.reopen_column_for(ctx, item)
        {
            self.wrap_to_band(ctx.all_bottom());
        }
        let y = if self.col_count > 0 {
            self.col_y + CARD_GAP
        } else {
            self.col_y
        };
        ctx.place(&item.id, self.x, y, item.w, item.h);
        self.col_ids.push(item.id.clone());
        self.col_y = y + item.h;
        self.col_count += 1;
        if !self.reopened {
            self.col_width = self.col_width.max(item.w);
        }
        if let Some(p) = &mut self.plan {
            p.placed[p.index] += 1;
        }
        self.bottom = self.bottom.max(self.col_y);
    }
}

fn rects_of(ctx: &Ctx, ids: &[String]) -> Vec<Rect> {
    ids.iter().filter_map(|id| ctx.nodes.get(id).copied()).collect()
}

/// Attachments of this stage not placed by the workbench (e.g. controls whose
/// visual arrived in a later step) go below their visuals, clear of the rest.
fn place_remaining_attachments(ctx: &mut Ctx, stage: usize) {
    for cluster in ctx.clusters.clone() {
        if cluster.stage != stage {
            continue;
        }
        let bound = rects_of(ctx, &cluster.visual_ids);
        if bound.is_empty() {
            continue;
        }
        for spec in [&cluster.controls, &cluster.tasks].into_iter().flatten() {
            if ctx.attachments.contains_key(&spec.id) {
                continue;
            }
            let x = bound[0].x;
            let mut y = bound
                .iter()
                .map(|r| r.y + r.height)
                .fold(f64::NEG_INFINITY, f64::max)
                + CONTROL_GAP;
            loop {
                let rect = Rect {
                    x,
                    y,
                    width: spec.width,
                    height: spec.height,
                };
                let hits: Vec<f64> = ctx
                    .nodes
                    .values()
                    .chain(ctx.attachments.values())
                    .filter(|r| overlaps(rect, **r))
                    .map(|r| r.y + r.height)
                    .collect();
                if hits.is_empty() {
                    break;
                }
                y = hits.into_iter().fold(f64::NEG_INFINITY, f64::max) + CARD_GAP;
            }
            ctx.place_attachment(spec, x, y);
        }
    }
}

fn wide_stage(ctx: &mut Ctx, stage_index: usize, stage: &Stage, top: f64) -> f64 {
    let own: Vec<Item> = ctx
        .items
        .iter()
        .filter(|i| stage.sections.contains(&i.section))
        .cloned()
        .collect();
    let opening: Vec<Item> = own
        .iter()
        .filter(|i| i.section == stage.open)
        .cloned()
        .collect();
    let first_visual = opening.iter().position(|i| i.visual);
    let lead_in: Vec<Item> = match first_visual {
        None => {
            if ctx.planned_visuals(&stage.open) > 0 {
                opening.clone()
            } else {
                vec![]
            }
        }
        Some(f) => opening[..f].iter().filter(|i| !i.visual).cloned().collect(),
    };
    let lead_ids: BTreeSet<String> = lead_in.iter().map(|i| i.id.clone()).collect();
    let visuals: Vec<Item> = opening.iter().filter(|i| i.visual).cloned().collect();
    let mut c = Cursor {
        x: 0.,
        col_top: top,
        col_width: 0.,
        col_y: top,
        col_count: 0,
        col_ids: vec![],
        row_right: 0.,
        reopened: false,
        plan: None,
        columns: vec![],
        bottom: top,
    };

    // 1. Lead-in text, left of the stage's first visual.
    if !lead_in.is_empty() {
        for item in &lead_in {
            c.add_primary(ctx, item);
        }
        c.open_column(WORKBENCH_GAP);
    }

    // 2. Workbench: practice (single-visual stages), visuals, docked controls.
    let mut reference_height = ctx.column_height;
    let mut reference_bottom = top;
    let plan_count = ctx.planned_visuals(&stage.open);
    if !visuals.is_empty() || plan_count > 0 {
        let cluster = ctx
            .clusters
            .iter()
            .find(|cl| {
                cl.stage == stage_index
                    && cl.controls.is_some()
                    && cl
                        .visual_ids
                        .iter()
                        .any(|id| visuals.iter().any(|v| &v.id == id))
            })
            .cloned();
        let controls = cluster.as_ref().and_then(|cl| cl.controls.clone());
        let beside_shape = plan_count <= 1;
        // Practice takes space only once it is open.
        let open_task = cluster.as_ref().and_then(|cl| cl.tasks.clone());
        let mut x0 = c.x;
        // A single visual's controls dock under it at its width, so they cost
        // no row width. Practice keeps its place left of the visual.
        if let (Some(_), true, Some(task)) = (&controls, beside_shape, &open_task) {
            ctx.place_attachment(task, x0, top);
            c.bottom = c.bottom.max(top + task.height);
            x0 += task.width + WORKBENCH_GAP;
        }
        let (mut vx, mut vy, mut line_height, mut right) = (x0, top, 0.0f64, x0);
        for (index, visual) in visuals.iter().enumerate() {
            let together = index > 0
                && (ctx.paired(&visuals[index - 1].id, &visual.id) || plan_count > 1)
                && vx - x0 + visual.w <= ctx.reading_width;
            if index > 0 && !together {
                vy += line_height + CARD_GAP;
                vx = x0;
                line_height = 0.;
            }
            ctx.place(&visual.id, vx, vy, visual.w, visual.h);
            right = right.max(vx + visual.w);
            vx += visual.w + CARD_GAP;
            line_height = line_height.max(visual.h);
        }
        let missing = plan_count.saturating_sub(visuals.len());
        if missing > 0 {
            let width = visuals.last().map_or(DEFAULT_VISUAL_WIDTH, |v| v.w);
            right =
                right.max(x0 + (visuals.len() + missing) as f64 * (width + CARD_GAP) - CARD_GAP);
        }
        let mut visual_bottom = if visuals.is_empty() {
            top + 360.
        } else {
            vy + line_height
        };
        reference_bottom = reference_bottom.max(visual_bottom);
        c.bottom = c.bottom.max(visual_bottom);
        if let (Some(controls), true) = (&controls, beside_shape) {
            let cl = cluster.as_ref().unwrap();
            let anchor = rects_of(ctx, &cl.visual_ids)
                .first()
                .copied()
                .or_else(|| visuals.first().map(|v| ctx.nodes[&v.id]));
            let dock_x = anchor.map_or(x0, |a| a.x);
            let dock_y = anchor.map_or(visual_bottom, |a| a.y + a.height) + DOCK_GAP;
            ctx.attachments.insert(
                controls.id.clone(),
                Rect {
                    x: dock_x,
                    y: dock_y,
                    width: anchor.map_or(controls.width, |a| a.width),
                    height: controls.height,
                },
            );
            visual_bottom = visual_bottom.max(dock_y + controls.height);
            reference_bottom = reference_bottom.max(visual_bottom);
            c.bottom = c.bottom.max(visual_bottom);
        }
        if let (Some(controls), false) = (&controls, beside_shape) {
            let cl = cluster.as_ref().unwrap();
            let bound_ids: Vec<&String> = cl
                .visual_ids
                .iter()
                .filter(|id| ctx.nodes.contains_key(*id))
                .collect();
            let bound = rects_of(ctx, &cl.visual_ids);
            let left = if bound.is_empty() {
                x0
            } else {
                bound.iter().map(|r| r.x).fold(f64::INFINITY, f64::min)
            };
            let span_right = if bound.is_empty() {
                right
            } else {
                bound
                    .iter()
                    .map(|r| r.x + r.width)
                    .fold(f64::NEG_INFINITY, f64::max)
            };
            // Controls shared by several visuals dock under the first of them
            // at its width, unless another visual sits under it (a wrapped
            // comparison); then they go below all of them.
            let docked = bound.first().map(|primary| Rect {
                x: primary.x,
                y: primary.y + primary.height + DOCK_GAP,
                width: primary.width,
                height: controls.height,
            });
            let collides = docked.is_some_and(|d| {
                visuals
                    .iter()
                    .any(|v| Some(&&v.id) != bound_ids.first() && overlaps(d, ctx.nodes[&v.id]))
            });
            let rect = match docked {
                Some(d) if !collides => d,
                _ => Rect {
                    x: left,
                    y: bound
                        .iter()
                        .map(|r| r.y + r.height)
                        .fold(visual_bottom, f64::max)
                        + CONTROL_GAP,
                    width: controls.width,
                    height: controls.height,
                },
            };
            ctx.attachments.insert(controls.id.clone(), rect);
            let mut bottom = rect.y + rect.height;
            reference_bottom = reference_bottom.max(bottom);
            if let Some(task) = &open_task {
                let beside_controls = span_right - rect.x >= rect.width + CARD_GAP + task.width;
                let tx = if beside_controls {
                    rect.x + rect.width + CARD_GAP
                } else {
                    rect.x
                };
                // Beside the controls, practice still starts below any visual above it.
                let ty = if beside_controls {
                    bound
                        .iter()
                        .copied()
                        .chain(visuals.iter().map(|v| ctx.nodes[&v.id]))
                        .filter(|r| r.x < tx + task.width && r.x + r.width > tx)
                        .map(|r| r.y + r.height + DOCK_GAP)
                        .fold(rect.y, f64::max)
                } else {
                    rect.y + rect.height + CARD_GAP
                };
                ctx.place_attachment(task, tx, ty);
                bottom = bottom.max(ty + task.height);
            }
            visual_bottom = visual_bottom.max(bottom);
            c.bottom = c.bottom.max(bottom);
        }
        // Task-only clusters (no controls) sit directly under their visuals.
        for cl in ctx.clusters.clone() {
            let Some(task) = cl.tasks.clone() else {
                continue;
            };
            if cl.stage != stage_index
                || cl.controls.is_some()
                || ctx.attachments.contains_key(&task.id)
            {
                continue;
            }
            let bound = rects_of(ctx, &cl.visual_ids);
            if bound.is_empty() {
                continue;
            }
            let x = bound.iter().map(|r| r.x).fold(f64::INFINITY, f64::min);
            let mut y = bound
                .iter()
                .map(|r| r.y + r.height)
                .fold(f64::NEG_INFINITY, f64::max)
                + CONTROL_GAP;
            loop {
                let rect = Rect {
                    x,
                    y,
                    width: task.width,
                    height: task.height,
                };
                let hits: Vec<f64> = ctx
                    .attachments
                    .values()
                    .filter(|r| overlaps(rect, **r))
                    .map(|r| r.y + r.height)
                    .collect();
                if hits.is_empty() {
                    break;
                }
                y = hits.into_iter().fold(f64::NEG_INFINITY, f64::max) + CARD_GAP;
            }
            ctx.place_attachment(&task, x, y);
            visual_bottom = visual_bottom.max(y + task.height);
            c.bottom = c.bottom.max(visual_bottom);
        }
        // The row height that guides column splitting ignores open practice.
        reference_height = reference_bottom - top;
        c.x = right + WORKBENCH_GAP;
        c.row_right = c.row_right.max(right);
    }
    let target = ctx
        .column_height
        .min(MIN_COLUMN_HEIGHT.max(reference_height));

    // 3. Explanation: one column group per step.
    c.col_top = top;
    c.col_width = 0.;
    c.col_y = top;
    c.col_count = 0;
    c.col_ids.clear();
    let mut first = true;
    for section in &stage.sections {
        let joining: Vec<Item> = own
            .iter()
            .filter(|i| &i.section == section && ctx.joiners.contains(&i.id))
            .cloned()
            .collect();
        if !joining.is_empty() {
            if !first {
                c.open_column(STEP_GAP);
            }
            first = false;
            for visual in &joining {
                if c.x > 0. && c.x + visual.w > ctx.reading_width {
                    let ab = ctx.all_bottom();
                    c.wrap_to_band(ab);
                }
                let (x, y) = (c.x, c.col_top);
                ctx.place(&visual.id, x, y, visual.w, visual.h);
                c.row_right = c.row_right.max(x + visual.w);
                c.x += visual.w + CARD_GAP;
                c.bottom = c.bottom.max(c.col_top + visual.h);
            }
            c.x += WORKBENCH_GAP - CARD_GAP;
        }
        let flow: Vec<Item> = own
            .iter()
            .filter(|i| &i.section == section && !i.visual && !lead_ids.contains(&i.id))
            .cloned()
            .collect();
        if flow.is_empty() {
            continue;
        }
        c.plan = None;
        let counts = ctx.planned.get(section).copied();
        let lead_count = if section == &stage.open {
            lead_in.len()
        } else {
            0
        };
        let planned_kinds = |counts: Planned| -> Vec<String> {
            std::iter::repeat("math")
                .take(counts.math)
                .chain(std::iter::repeat("note").take(counts.text))
                .skip(lead_count)
                .map(str::to_owned)
                .collect()
        };
        // A short step continues under the previous step's column when its
        // planned cards fit there, instead of opening a column at the row's end.
        let step_kinds: Vec<String> = match counts {
            Some(counts) => planned_kinds(counts),
            None => flow.iter().map(|i| i.kind.clone()).collect(),
        };
        let before = ctx
            .items
            .iter()
            .position(|i| i.id == flow[0].id)
            .unwrap_or(0);
        let gaps = |n: usize| CARD_GAP * (n as f64 - 1.);
        let (step_height, step_width) = if counts.is_some() {
            (
                step_kinds
                    .iter()
                    .map(|k| ctx.estimate(k, true, before))
                    .sum::<f64>()
                    + gaps(step_kinds.len()),
                step_kinds
                    .iter()
                    .map(|k| ctx.estimate(k, false, before))
                    .fold(flow[0].w, f64::max),
            )
        } else {
            (
                flow.iter().map(|i| i.h).sum::<f64>() + gaps(flow.len()),
                max0(flow.iter().map(|i| i.w)).max(flow[0].w),
            )
        };
        let stack = !first
            && joining.is_empty()
            && c.col_count > 0
            && step_kinds.len() <= STACK_STEP_MAX_CARDS
            && step_width
                <= c.col_width
                    * if c.reopened {
                        1.
                    } else {
                        STACK_WIDTH_RATIO
                    }
            && c.x + step_width <= ctx.reading_width
            && c.col_y + STEP_GAP + step_height <= c.col_top + ctx.column_height;
        if stack {
            c.col_y += STEP_GAP - CARD_GAP;
        } else if !first && joining.is_empty() {
            c.open_column(STEP_GAP);
        }
        first = false;
        if let (Some(counts), false) = (counts, stack) {
            let kinds = planned_kinds(counts);
            if !kinds.is_empty() {
                let heights: Vec<f64> = kinds
                    .iter()
                    .map(|k| ctx.estimate(k, true, before))
                    .collect();
                let widths: Vec<f64> = kinds
                    .iter()
                    .map(|k| ctx.estimate(k, false, before))
                    .collect();
                let total = heights.iter().sum::<f64>() + gaps(heights.len());
                let k = heights.len().min(((total / target).ceil() as usize).max(1));
                let mut split = balanced_counts(&heights, k);
                let mut offset = 0;
                let estimated_width = split
                    .iter()
                    .map(|&n| {
                        let w = widths[offset..offset + n]
                            .iter()
                            .cloned()
                            .fold(f64::NEG_INFINITY, f64::max);
                        offset += n;
                        w
                    })
                    .sum::<f64>()
                    + SUBCOLUMN_GAP * (split.len() as f64 - 1.);
                if c.x > 0. && c.x + estimated_width > ctx.reading_width {
                    if !c.reopen_column_for(ctx, &flow[0]) {
                        let ab = ctx.all_bottom();
                        c.wrap_to_band(ab);
                    } else {
                        split = vec![flow.len()];
                    }
                }
                c.plan = Some(Plan {
                    placed: vec![0; split.len()],
                    counts: split,
                    index: 0,
                });
            }
        }
        if c.plan.is_none()
            && !stack
            && c.col_count == 0
            && c.x > 0.
            && c.x + flow[0].w > ctx.reading_width
            && !c.reopen_column_for(ctx, &flow[0])
        {
            let ab = ctx.all_bottom();
            c.wrap_to_band(ab);
        }
        for item in &flow {
            c.add_primary(ctx, item);
        }
    }
    c.close_column();
    // Neat columns: text cards take their column's width; visuals keep theirs.
    for column in &c.columns {
        for id in &column.ids {
            if let Some(r) = ctx.nodes.get_mut(id) {
                r.width = column.width;
            }
        }
    }
    place_remaining_attachments(ctx, stage_index);
    c.bottom.max(ctx.all_bottom())
}

/// Narrow windows: one readable stream.
fn narrow_stage(ctx: &mut Ctx, stage_index: usize, stage: &Stage, top: f64) -> f64 {
    let own: Vec<Item> = ctx
        .items
        .iter()
        .filter(|i| stage.sections.contains(&i.section))
        .cloned()
        .collect();
    let width = ctx.reading_width.min(max0(own.iter().map(|i| i.w)));
    let mut y = top;
    let opening: Vec<Item> = own
        .iter()
        .filter(|i| i.section == stage.open)
        .cloned()
        .collect();
    let first_visual = opening.iter().position(|i| i.visual);
    let lead_in: Vec<Item> = match first_visual {
        Some(f) if f > 0 => opening[..f].to_vec(),
        _ => vec![],
    };
    for item in &lead_in {
        ctx.place(&item.id, 0., y, width, item.h);
        y += item.h + CARD_GAP;
    }
    let visuals: Vec<Item> = opening.iter().filter(|i| i.visual).cloned().collect();
    let mut done = BTreeSet::new();
    let mut i = 0;
    while i < visuals.len() {
        let visual = &visuals[i];
        let row: Vec<Item> = match visuals.get(i + 1) {
            Some(next)
                if ctx.paired(&visual.id, &next.id)
                    && visual.w + CARD_GAP + next.w <= ctx.reading_width =>
            {
                vec![visual.clone(), next.clone()]
            }
            _ => vec![visual.clone()],
        };
        let (mut x, mut height) = (0., 0.0f64);
        for item in &row {
            ctx.place(&item.id, x, y, item.w, item.h);
            x += item.w + CARD_GAP;
            height = height.max(item.h);
        }
        y += height;
        if row.len() > 1 {
            i += 1;
        }
        for (index, cluster) in ctx.clusters.clone().iter().enumerate() {
            if cluster.stage != stage_index
                || done.contains(&index)
                || !row.iter().any(|item| cluster.visual_ids.contains(&item.id))
            {
                continue;
            }
            done.insert(index);
            if let Some(controls) = &cluster.controls {
                y += CONTROL_GAP;
                ctx.place_attachment(controls, 0., y);
                y += controls.height;
            }
            if let Some(tasks) = &cluster.tasks {
                y += CARD_GAP;
                ctx.place_attachment(tasks, 0., y);
                y += tasks.height;
            }
        }
        y += CARD_GAP;
        i += 1;
    }
    if !visuals.is_empty() {
        y += STEP_GAP - CARD_GAP;
    }
    let lead_ids: BTreeSet<String> = lead_in.iter().map(|i| i.id.clone()).collect();
    let mut first = true;
    for section in &stage.sections {
        let joining: Vec<Item> = own
            .iter()
            .filter(|i| &i.section == section && ctx.joiners.contains(&i.id))
            .cloned()
            .collect();
        let cards: Vec<Item> = own
            .iter()
            .filter(|i| &i.section == section && !i.visual && !lead_ids.contains(&i.id))
            .cloned()
            .collect();
        if cards.is_empty() && joining.is_empty() {
            continue;
        }
        if !first {
            y += STEP_GAP - CARD_GAP;
        }
        first = false;
        for visual in &joining {
            ctx.place(&visual.id, 0., y, visual.w, visual.h);
            y += visual.h + CARD_GAP;
        }
        for item in &cards {
            ctx.place(&item.id, 0., y, width, item.h);
            y += item.h + CARD_GAP;
        }
    }
    place_remaining_attachments(ctx, stage_index);
    top.max(y - CARD_GAP).max(ctx.all_bottom())
}

/// Web computeTeachingRegion for the given node ids of one region.
/// `external` holds rectangles already placed by other regions.
pub fn layout_region(
    p: &Preview,
    ids: &[String],
    sizes: &BTreeMap<String, (f64, f64)>,
    region: &Region,
    external: &[Rect],
) -> Result<TeachingLayout, String> {
    let (top_i, right_i, bottom_i, left_i) = region.insets;
    let safe_width = region.width - left_i - right_i - SAFE_MARGIN;
    let safe_height = region.height - top_i - bottom_i - SAFE_MARGIN;
    let reading_scale = region
        .reading_scale
        .filter(|s| s.is_finite() && *s > 0.)
        .map_or(READING_SCALE, |s| s.clamp(0.3, 1.5));
    let reading_width = (safe_width / reading_scale).max(320.);
    let column_height = (safe_height / reading_scale).max(MIN_COLUMN_HEIGHT);

    let order: BTreeMap<&str, usize> = region
        .node_sections
        .iter()
        .enumerate()
        .map(|(i, (id, _))| (id.as_str(), i))
        .collect();
    let section_of: BTreeMap<&str, &str> = region
        .node_sections
        .iter()
        .map(|(id, s)| (id.as_str(), s.as_str()))
        .collect();
    let mut sorted: Vec<&String> = ids.iter().collect();
    // Stable sort, like Array.prototype.sort.
    sorted.sort_by_key(|id| order.get(id.as_str()).copied().unwrap_or(usize::MAX));
    let mut items = Vec::new();
    for id in sorted {
        let node = p
            .nodes
            .iter()
            .find(|n| n["id"] == id.as_str())
            .ok_or("Unknown teaching node")?;
        let kind = node["kind"].as_str().unwrap_or("text").to_owned();
        let &(w, h) = sizes
            .get(id)
            .ok_or_else(|| format!("Missing measured size {id}"))?;
        items.push(Item {
            id: id.clone(),
            section: section_of
                .get(id.as_str())
                .copied()
                .unwrap_or("legacy")
                .to_owned(),
            visual: is_visual(&kind),
            kind,
            w,
            h,
        });
    }
    let mut sections: Vec<String> = Vec::new();
    for item in &items {
        if !sections.contains(&item.section) {
            sections.push(item.section.clone());
        }
    }
    let mut planned = BTreeMap::new();
    if let Some(steps) = &region.planned_steps {
        let step_order: BTreeMap<&str, usize> = steps
            .iter()
            .enumerate()
            .map(|(i, (s, _))| (s.as_str(), i))
            .collect();
        sections.sort_by_key(|s| step_order.get(s.as_str()).copied().unwrap_or(usize::MAX));
        planned = steps.iter().cloned().collect();
    }
    let mut ctx = Ctx {
        p,
        items,
        planned,
        clusters: vec![],
        pairs: vec![],
        joiners: BTreeSet::new(),
        reading_width,
        column_height,
        nodes: BTreeMap::new(),
        attachments: BTreeMap::new(),
    };

    // Comparison sets: explicit groups/connections, or a comparison/supporting
    // visual placed right_of another visual of the same step.
    for group in &p.groups {
        let visuals: Vec<String> = ctx
            .members(group["id"].as_str().unwrap_or(""), &mut BTreeSet::new())
            .into_iter()
            .filter(|id| ctx.item(id).is_some_and(|i| i.visual))
            .collect();
        if visuals.len() > 1 {
            ctx.pairs.push(visuals);
        }
    }
    let endpoint = |v: &Value| {
        v.as_str()
            .or(v["node_id"].as_str())
            .unwrap_or("")
            .to_owned()
    };
    for connection in &p.connections {
        let (a, b) = (endpoint(&connection["from"]), endpoint(&connection["to"]));
        if ctx.item(&a).is_some_and(|i| i.visual) && ctx.item(&b).is_some_and(|i| i.visual) {
            ctx.pairs.push(vec![a, b]);
        }
    }
    let side_role = |node: &Value| {
        matches!(
            node["role"].as_str().unwrap_or(""),
            "comparison_visual" | "supporting_visual"
        )
    };
    for item in ctx.items.clone() {
        let node = ctx.node(&item.id).unwrap().clone();
        let anchor = node["placement"]["anchor"].as_str().unwrap_or("");
        if let Some(a) = ctx.item(anchor) {
            if item.visual
                && node["placement"]["relation"] == "right_of"
                && a.visual
                && a.section == item.section
                && side_role(&node)
            {
                let pair = vec![a.id.clone(), item.id.clone()];
                ctx.pairs.push(pair);
            }
        }
    }

    // A comparison/supporting view right_of a visual from an earlier step joins
    // that visual's row instead of opening a new stage.
    let anchor_visuals = |ctx: &Ctx, id: &str| -> Vec<Item> {
        if let Some(direct) = ctx.item(id) {
            return if direct.visual {
                vec![direct.clone()]
            } else {
                vec![]
            };
        }
        ctx.members(id, &mut BTreeSet::new())
            .iter()
            .filter_map(|m| ctx.item(m).cloned())
            .filter(|i| i.visual)
            .collect()
    };
    let joins_earlier_row = |ctx: &Ctx, item: &Item, stage_sections: &[String]| -> bool {
        let node = ctx.node(&item.id).unwrap();
        if !item.visual || node["placement"]["relation"] != "right_of" || !side_role(node) {
            return false;
        }
        let anchors = anchor_visuals(ctx, node["placement"]["anchor"].as_str().unwrap_or(""));
        !anchors.is_empty()
            && anchors
                .iter()
                .all(|a| a.section != item.section && stage_sections.contains(&a.section))
    };
    let mut stages: Vec<Stage> = Vec::new();
    for section in &sections {
        let section_visuals: Vec<Item> = ctx
            .items
            .iter()
            .filter(|i| &i.section == section && i.visual)
            .cloned()
            .collect();
        let joining = !stages.is_empty()
            && !section_visuals.is_empty()
            && section_visuals
                .iter()
                .all(|i| joins_earlier_row(&ctx, i, &stages.last().unwrap().sections));
        if joining {
            for i in &section_visuals {
                ctx.joiners.insert(i.id.clone());
            }
        }
        if stages.is_empty() || (ctx.planned_visuals(section) > 0 && !joining) {
            stages.push(Stage {
                open: section.clone(),
                sections: vec![section.clone()],
            });
        } else {
            stages.last_mut().unwrap().sections.push(section.clone());
        }
    }
    // An attachment has one display owner. Its dependency set may span rows,
    // but must never reserve space in every row that uses the same variable.
    let stage_of = |id: &str| -> Option<usize> {
        let section = &ctx.item(id)?.section;
        stages.iter().position(|s| s.sections.contains(section))
    };
    let mut clusters: Vec<Cluster> = Vec::new();
    for attachment in &region.attachments {
        let task = match attachment.kind {
            AttachmentKind::Reflection => continue,
            AttachmentKind::Task => true,
            AttachmentKind::Control => false,
        };
        let targets = &attachment.anchor_node_ids;
        let owner = attachment.owner_node_id.clone().or_else(|| {
            if task {
                Some(attachment.anchor_node_id.clone())
            } else {
                targets
                    .iter()
                    .find(|id| ctx.item(id).is_some_and(|i| i.visual))
                    .cloned()
            }
        });
        // A declared owner that has not arrived yet must not fall back to an unrelated row.
        let Some(stage) = owner.as_deref().and_then(stage_of) else {
            continue;
        };
        let visual_ids: Vec<String> = targets
            .iter()
            .filter(|id| ctx.item(id).is_some_and(|i| i.visual) && stage_of(id) == Some(stage))
            .cloned()
            .collect();
        if visual_ids.is_empty() {
            continue;
        }
        let index = clusters
            .iter()
            .position(|c| {
                c.stage == stage
                    && if task {
                        c.tasks.is_none()
                    } else {
                        c.controls.is_none()
                    }
                    && c.visual_ids.iter().any(|id| visual_ids.contains(id))
            })
            .unwrap_or_else(|| {
                clusters.push(Cluster {
                    stage,
                    ..Cluster::default()
                });
                clusters.len() - 1
            });
        let cluster = &mut clusters[index];
        for id in visual_ids {
            if !cluster.visual_ids.contains(&id) {
                cluster.visual_ids.push(id);
            }
        }
        if task {
            cluster.tasks = Some(attachment.clone());
        } else {
            cluster.controls = Some(attachment.clone());
        }
    }
    ctx.clusters = clusters;
    let widest_visual = max0(ctx.items.iter().filter(|i| i.visual).map(|i| i.w));
    let wide =
        reading_width >= DEFAULT_VISUAL_WIDTH.max(widest_visual) + WORKBENCH_GAP + MIN_WIDE_COLUMN;

    let mut previous: Option<f64> = None;
    for (index, stage) in stages.iter().enumerate() {
        let top = previous.map_or(0., |b| b + STAGE_GAP);
        let bottom = if wide {
            wide_stage(&mut ctx, index, stage, top)
        } else {
            narrow_stage(&mut ctx, index, stage, top)
        };
        previous = Some(bottom);
    }

    // A thinking-question card opens after the lesson directly under the card
    // that poses it, at that card's width. Content below it in the same
    // columns moves down once, like opening practice.
    for spec in &region.attachments {
        if spec.kind != AttachmentKind::Reflection {
            continue;
        }
        let Some(anchor) = ctx.nodes.get(&spec.anchor_node_id).copied() else {
            continue;
        };
        let anchor_bottom = anchor.y + anchor.height;
        let card = Rect {
            x: anchor.x,
            y: anchor_bottom + CARD_GAP,
            width: anchor.width,
            height: spec.height,
        };
        let shift = card.height + CARD_GAP;
        let mut moved = vec![card];
        let mut below: Vec<&mut Rect> = ctx
            .nodes
            .iter_mut()
            .filter(|(id, _)| **id != spec.anchor_node_id)
            .map(|(_, r)| r)
            .chain(ctx.attachments.values_mut())
            .filter(|r| r.y >= anchor_bottom - 1.)
            .collect();
        below.sort_by(|a, b| a.y.total_cmp(&b.y));
        for rect in below {
            if !moved
                .iter()
                .any(|m| rect.x < m.x + m.width && rect.x + rect.width > m.x)
            {
                continue;
            }
            rect.y += shift;
            moved.push(*rect);
        }
        ctx.attachments.insert(spec.id.clone(), card);
    }

    let mut nodes = ctx.nodes;
    let mut attachments = ctx.attachments;
    let placed: Vec<Rect> = nodes
        .values()
        .chain(attachments.values())
        .copied()
        .collect();
    if placed.is_empty() {
        return Ok(TeachingLayout { nodes, attachments });
    }
    // Translate the complete composition around other regions and obstacles.
    let mut b = Rect {
        x: region.x,
        y: region.y,
        ..bounds(&placed)
    };
    let obstacles: Vec<Rect> = external
        .iter()
        .chain(region.obstacles.iter())
        .copied()
        .collect();
    for _ in 0..=obstacles.len() {
        let hits: Vec<&Rect> = obstacles.iter().filter(|r| overlaps(b, **r)).collect();
        if hits.is_empty() {
            break;
        }
        b.y = hits
            .iter()
            .map(|r| r.y + r.height)
            .fold(f64::NEG_INFINITY, f64::max)
            + OBSTACLE_GAP;
    }
    for r in nodes.values_mut().chain(attachments.values_mut()) {
        r.x += b.x;
        r.y += b.y;
    }
    Ok(TeachingLayout { nodes, attachments })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn balanced_counts_minimise_the_tallest_group() {
        assert_eq!(balanced_counts(&[90., 90., 90., 90.], 2), vec![2, 2]);
        assert_eq!(balanced_counts(&[300., 90., 90., 90.], 2), vec![1, 3]);
        assert_eq!(balanced_counts(&[90.], 3), vec![1]);
    }
}

/// Identifiers of a math expression (lower-cased), like core tokenize.
fn identifiers(expression: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_number = false;
    for ch in expression.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            if current.is_empty() && ch.is_ascii_digit() {
                in_number = true;
            }
            current.push(ch);
        } else {
            if !current.is_empty() && !in_number {
                out.push(current.to_ascii_lowercase());
            }
            current.clear();
            in_number = false;
        }
        if in_number && !(ch.is_ascii_digit() || ch == '.') {
            in_number = false;
        }
    }
    out
}
fn referenced_variables(value: &Value, allowed: &[String], out: &mut Vec<String>) {
    let add = |alias: &str, out: &mut Vec<String>| {
        if allowed.iter().any(|a| a == alias) && !out.iter().any(|o| o == alias) {
            out.push(alias.to_owned());
        }
    };
    match value {
        Value::Array(items) => items
            .iter()
            .for_each(|v| referenced_variables(v, allowed, out)),
        Value::Object(map) => {
            for (key, child) in map {
                if key == "variable" {
                    if let Some(s) = child.as_str() {
                        add(s, out);
                    }
                }
                if key == "expression" {
                    if let Some(s) = child.as_str() {
                        for id in identifiers(s) {
                            if let Some(alias) =
                                allowed.iter().find(|a| a.to_ascii_lowercase() == id)
                            {
                                let alias = alias.clone();
                                add(&alias, out);
                            }
                        }
                    }
                }
                referenced_variables(child, allowed, out);
            }
        }
        _ => {}
    }
}

/// The control panels of `control_clusters` without their slider aliases.
pub fn control_attachments(
    p: &Preview,
    region_id: &str,
    course_node_ids: &[String],
    declarations: &[Value],
) -> Vec<Attachment> {
    control_clusters(p, region_id, course_node_ids, declarations)
        .into_iter()
        .map(|(a, _)| a)
        .collect()
}

/// octos-learn buildInteractionClusters (controls only) plus the host's
/// control panel sizing: one 360-wide panel per group of sliders that drive
/// the same visuals, anchored at the group's last delivered visual and owned
/// (displayed) by its first.
/// `course_node_ids` is the course's planned node order (topic.nodeIds).
pub fn control_clusters(
    p: &Preview,
    region_id: &str,
    course_node_ids: &[String],
    declarations: &[Value],
) -> Vec<(Attachment, Vec<String>)> {
    let aliases: Vec<String> = declarations
        .iter()
        .filter_map(|d| d["as"].as_str().map(str::to_owned))
        .collect();
    let controls: Vec<String> = declarations
        .iter()
        .filter(|d| d["control"]["kind"] == "slider")
        .filter_map(|d| d["as"].as_str().map(str::to_owned))
        .collect();
    let topic_nodes: Vec<&String> = course_node_ids
        .iter()
        .filter(|id| p.nodes.iter().any(|n| n["id"] == id.as_str()))
        .collect();
    let mut variables_by_node: Vec<(String, Vec<String>)> = Vec::new();
    for id in &topic_nodes {
        let node = p.nodes.iter().find(|n| n["id"] == id.as_str()).unwrap();
        if !is_visual(node["kind"].as_str().unwrap_or("")) {
            continue;
        }
        let mut vars = Vec::new();
        referenced_variables(&node["content"], &aliases, &mut vars);
        variables_by_node.push(((*id).clone(), vars));
    }
    let active: Vec<&String> = controls.iter().filter(|c| aliases.contains(c)).collect();
    let mut visited: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for initial in &active {
        if visited.contains(initial) {
            continue;
        }
        let mut group_aliases: Vec<String> = Vec::new();
        let mut node_ids: BTreeSet<String> = BTreeSet::new();
        let mut queue = vec![(*initial).clone()];
        while !queue.is_empty() {
            let alias = queue.remove(0);
            if visited.contains(&alias) {
                continue;
            }
            visited.push(alias.clone());
            group_aliases.push(alias.clone());
            for (node, vars) in variables_by_node.iter().filter(|(_, v)| v.contains(&alias)) {
                node_ids.insert(node.clone());
                for peer in vars {
                    if active.contains(&peer) && !visited.contains(peer) {
                        queue.push(peer.clone());
                    }
                }
            }
        }
        if node_ids.is_empty() {
            continue;
        }
        let ordered: Vec<String> = topic_nodes
            .iter()
            .filter(|id| node_ids.contains(id.as_str()))
            .map(|id| (*id).clone())
            .collect();
        let sliders: Vec<String> = group_aliases
            .into_iter()
            .filter(|a| controls.contains(a))
            .collect();
        let n = sliders.len() as f64;
        out.push((
            Attachment {
                id: format!("{region_id}:interaction:{}", out.len() + 1),
                kind: AttachmentKind::Control,
                anchor_node_id: ordered.last().cloned().unwrap_or_default(),
                // Controls belong to the first bound visual.
                owner_node_id: ordered.first().cloned(),
                anchor_node_ids: ordered,
                width: 360.,
                // Compact panel: 5px padding and 1px border on each side, 24px rows, 4px gaps.
                height: 12. + n * 24. + (n - 1.).max(0.) * 4.,
            },
            sliders,
        ));
    }
    out
}
