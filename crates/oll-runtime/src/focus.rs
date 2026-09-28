//! Teaching-camera policy for one playback render, ported from
//! web-runtime board-view.ts (render focus, animation framing,
//! resolveFocusRects, supportingVisualFocusTargets, focusTargets) and the
//! octos-learn host (planHostTeachingFocus, course-end overview).
//!
//! A host calls `Policy::render` after every state change it draws. The
//! returned plan is the camera the Web would end at for that render: the
//! board view's own decision, then the host's Beat composition override.
use crate::camera::{self, Insets, Mode};
use crate::preview::Preview;
use crate::spatial::{variable_targets, BoardLayout, Camera, Rect};
use serde_json::Value;
use std::collections::BTreeSet;

/// Lowest scale at which an animation is framed together with the Beat target.
pub const ANIMATION_CONTEXT_MIN_SCALE: f64 = 0.75;

fn primary_visual(kind: &str) -> bool {
    matches!(
        kind,
        "geometry" | "plot" | "scene3d" | "diagram" | "image" | "table"
    )
}
fn target_id(t: &Value) -> Option<&str> {
    t.as_str()
        .or(t["node_id"].as_str())
        .or(t["group_id"].as_str())
        .or(t["connection_id"].as_str())
}

/// Viewport and host inputs of a render.
pub struct View<'a> {
    pub width: f64,
    pub height: f64,
    pub insets: &'a Insets,
    /// Host attachments with their camera focus height (controls panels).
    pub attachments: &'a [(String, Vec<String>, f64)],
    pub scale_floor: f64,
}

#[derive(Default, Clone, Debug)]
pub struct Policy {
    last_attention: Vec<String>,
    rendered_cursor: Option<usize>,
    rendered_composition: String,
    animation_was_active: bool,
    course_framed: bool,
}

impl Policy {
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Web targetRect + resolveFocusRects: targets, group members, connection
    /// endpoints, the supporting visual of each target, and the rendered
    /// control panel of any anchor among them.
    pub fn focus_rects(
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        view: &View,
    ) -> Vec<Rect> {
        let mut visited = BTreeSet::new();
        let mut rects = Vec::new();
        fn visit(
            p: &Preview,
            layout: &BoardLayout,
            id: &str,
            visited: &mut BTreeSet<String>,
            rects: &mut Vec<Rect>,
        ) {
            if !visited.insert(id.to_owned()) {
                return;
            }
            if let Some(r) = target_rect(p, layout, id) {
                rects.push(r);
            }
            if let Some(g) = p.groups.iter().find(|g| g["id"] == id) {
                for m in g["members"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    visit(p, layout, m, visited, rects);
                }
            }
            if let Some(c) = p.connections.iter().find(|c| c["id"] == id) {
                for end in ["from", "to"] {
                    if let Some(e) = target_id(&c[end]) {
                        visit(p, layout, e, visited, rects);
                    }
                }
            }
        }
        for id in targets {
            visit(p, layout, id, &mut visited, &mut rects);
        }
        for id in supporting_visuals(p, layout, targets) {
            visit(p, layout, &id, &mut visited, &mut rects);
        }
        for (id, anchors, focus_height) in view.attachments {
            if !anchors.iter().any(|a| visited.contains(a)) {
                continue;
            }
            if let Some(r) = layout.attachments.get(id) {
                let h = r.height.min(focus_height.max(0.));
                if h > 0. {
                    rects.push(Rect { height: h, ..*r });
                }
            }
        }
        rects
    }

    /// Web focusRects: the attention mode follows what is framed.
    fn plan(
        p: &Preview,
        targets: &[String],
        rects: &[Rect],
        current: Camera,
        view: &View,
    ) -> Camera {
        let mode = if rects.len() > 1
            || targets
                .iter()
                .any(|id| p.connections.iter().any(|c| c["id"] == id.as_str()))
        {
            Mode::Relationship
        } else if targets
            .iter()
            .any(|id| p.groups.iter().any(|g| g["id"] == id.as_str()))
        {
            Mode::Overview
        } else {
            Mode::Detail
        };
        camera::plan_focus(
            rects,
            current,
            view.width,
            view.height,
            mode,
            view.insets,
            view.scale_floor,
        )
    }

    fn readable_together(
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        current: Camera,
        view: &View,
    ) -> bool {
        let rects = Self::focus_rects(p, layout, targets, view);
        if rects.is_empty() {
            return false;
        }
        let cam = camera::plan_focus(
            &rects,
            current,
            view.width,
            view.height,
            Mode::Relationship,
            view.insets,
            view.scale_floor,
        );
        cam.scale >= ANIMATION_CONTEXT_MIN_SCALE
    }

    /// The camera after rendering the current state, or None when the Web
    /// would leave the camera where it is. `automatic` is false while the
    /// learner has taken manual control (pan/zoom) and no new teaching
    /// operation has arrived.
    pub fn render(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        let operation = p.cursor.checked_sub(1).and_then(|i| p.frame_action(i));
        let new_operation = self.rendered_cursor != Some(p.cursor);
        let animating = p.animating();
        let beat = p.current_beat().map(str::to_owned).unwrap_or_default();
        let composition_targets = if beat.is_empty() {
            vec![]
        } else {
            p.beat_focus_targets(&beat)
        };
        let composition_key = format!("{beat}\u{0}{}", composition_targets.join("\u{0}"));
        let composition_changed = composition_key != self.rendered_composition;
        let op = operation
            .map(|a| a["op"].as_str().unwrap_or(""))
            .unwrap_or("");
        let composition_operation_changed = new_operation
            && matches!(
                op,
                "board.create"
                    | "board.revise"
                    | "board.emphasize"
                    | "board.group"
                    | "board.connect"
            );
        let animation_ended = self.animation_was_active && !animating;

        // 1. Board view render (only a new teaching operation moves it).
        let mut camera = current;
        let mut moved = false;
        if new_operation {
            if let Some(action) = operation {
                let animated = if action["op"] == "lesson.variable.animate" {
                    variable_targets(p, action["animation"]["variable"].as_str().unwrap_or(""))
                } else {
                    vec![]
                };
                let declared: Vec<String> = action["focus"]["targets"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect();
                let requested = if animated.is_empty() {
                    declared
                } else {
                    let outside: Vec<String> = composition_targets
                        .iter()
                        .filter(|id| !animated.contains(id))
                        .cloned()
                        .collect();
                    if outside.is_empty() {
                        animated
                    } else {
                        let union: Vec<String> =
                            animated.iter().chain(outside.iter()).cloned().collect();
                        if Self::readable_together(p, layout, &union, camera, view) {
                            union
                        } else {
                            composition_targets.clone()
                        }
                    }
                };
                let rects = Self::focus_rects(p, layout, &requested, view);
                if !rects.is_empty() {
                    if !requested.is_empty() {
                        self.last_attention = requested.clone();
                    }
                    camera = Self::plan(p, &requested, &rects, camera, view);
                    moved = true;
                } else if matches!(
                    op,
                    "board.create" | "board.revise" | "board.emphasize" | "teacher.point"
                ) {
                    let active = if op == "board.create" {
                        action["node"]["id"].as_str()
                    } else {
                        target_id(&action["target"])
                    };
                    if let Some(id) = active {
                        if let Some(r) = target_rect(p, layout, id) {
                            let targets = vec![id.to_owned()];
                            self.last_attention = targets.clone();
                            camera = Self::plan(p, &targets, &[r], camera, view);
                            moved = true;
                        }
                    }
                }
            }
        }

        // 2. Host composition (planHostTeachingFocus), applied after the view.
        let host_targets = if animating {
            None
        } else if animation_ended && !composition_targets.is_empty() {
            Some(composition_targets.clone())
        } else if !composition_targets.is_empty()
            && (composition_changed || composition_operation_changed)
        {
            Some(composition_targets.clone())
        } else {
            None
        };
        if let Some(targets) = host_targets {
            let rects = Self::focus_rects(p, layout, &targets, view);
            if !rects.is_empty() {
                self.last_attention = targets.clone();
                camera = Self::plan(p, &targets, &rects, camera, view);
                moved = true;
            }
        }

        self.rendered_cursor = Some(p.cursor);
        self.rendered_composition = composition_key;
        self.animation_was_active = animating;
        moved.then_some(camera)
    }

    /// octos-learn course-end overview: once playback completes, frame every
    /// course card and host panel in "course" mode (a navigation boundary,
    /// small margin, no readability floor). Returns the camera once.
    pub fn course_end(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        if !p.complete() {
            self.course_framed = false;
            return None;
        }
        if self.course_framed {
            return None;
        }
        let rects: Vec<Rect> = layout
            .nodes
            .values()
            .chain(layout.attachments.values())
            .copied()
            .collect();
        let bounds = Rect::union(&rects, 0.)?;
        self.course_framed = true;
        Some(camera::plan_focus(
            &[bounds],
            current,
            view.width,
            view.height,
            Mode::Course,
            view.insets,
            view.scale_floor,
        ))
    }
}

/// Web targetRect: node, group, or the union of a connection's two ends.
pub fn target_rect(p: &Preview, layout: &BoardLayout, id: &str) -> Option<Rect> {
    if let Some(r) = layout.nodes.get(id).or(layout.groups.get(id)) {
        return Some(*r);
    }
    let c = p.connections.iter().find(|c| c["id"] == id)?;
    let a = target_rect(p, layout, target_id(&c["from"])?)?;
    let b = target_rect(p, layout, target_id(&c["to"])?)?;
    Rect::union(&[a, b], 0.)
}

/// Web supportingVisualFocusTargets: a primary visual brings its connected
/// visual peers; a text card brings the nearest primary visual of its region.
pub fn supporting_visuals(p: &Preview, layout: &BoardLayout, targets: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |id: String| {
        if !out.contains(&id) {
            out.push(id);
        }
    };
    for target in targets {
        let Some(node) = p.nodes.iter().find(|n| n["id"] == target.as_str()) else {
            continue;
        };
        let Some(region) = node["region_id"].as_str().filter(|r| !r.is_empty()) else {
            continue;
        };
        if primary_visual(node["kind"].as_str().unwrap_or("")) {
            for c in &p.connections {
                let (a, b) = (target_id(&c["from"]), target_id(&c["to"]));
                let peer = if a == Some(target) {
                    b
                } else if b == Some(target) {
                    a
                } else {
                    None
                };
                if let Some(peer) = peer.and_then(|id| p.nodes.iter().find(|n| n["id"] == id)) {
                    if peer["region_id"] == region
                        && primary_visual(peer["kind"].as_str().unwrap_or(""))
                    {
                        add(peer["id"].as_str().unwrap_or("").to_owned());
                    }
                }
            }
            continue;
        }
        let Some(tr) = layout.nodes.get(target) else {
            continue;
        };
        let center = |r: &Rect| (r.x + r.width / 2., r.y + r.height / 2.);
        let (tx, ty) = center(tr);
        let nearest = p
            .nodes
            .iter()
            .filter(|n| {
                n["id"] != target.as_str()
                    && n["region_id"] == region
                    && primary_visual(n["kind"].as_str().unwrap_or(""))
                    && layout.nodes.contains_key(n["id"].as_str().unwrap_or(""))
            })
            .map(|n| {
                let r = layout.nodes[n["id"].as_str().unwrap()];
                let (x, y) = center(&r);
                ((x - tx).hypot(y - ty), n["id"].as_str().unwrap().to_owned())
            })
            // Stable: the first node wins ties, like Array.prototype.sort.
            .fold(None::<(f64, String)>, |best, c| match best {
                Some(b) if b.0 <= c.0 => Some(b),
                _ => Some(c),
            });
        if let Some((_, id)) = nearest {
            add(id);
        }
    }
    out
}
