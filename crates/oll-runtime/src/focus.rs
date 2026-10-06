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
/// The Beat's own targets join a narrower request only if the frame keeps this share of its scale.
const BEAT_CONTEXT_MIN_SCALE_SHARE: f64 = 0.8;
/// A Beat's composed frame at or above this scale is readable on any host.
const CONTEXT_READABLE_SCALE: f64 = 0.55;
/// Earlier cards of the Step join only if the frame stays nearly as close.
const STEP_CONTEXT_MIN_SCALE_SHARE: f64 = 0.92;
/// A supporting visual joins a note's frame only if the frame keeps this share of its scale.
const SUPPORTING_VISUAL_MIN_SCALE_SHARE: f64 = 0.85;

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
    /// Zoom ceiling for automatic teaching focus (web automaticCameraMaximumScale).
    pub scale_ceiling: f64,
}

#[derive(Default, Clone, Debug)]
pub struct Policy {
    last_attention: Vec<String>,
    rendered_cursor: Option<usize>,
    rendered_composition: String,
    animation_was_active: bool,
    /// Bounds of the last course-end frame (re-framed when they change).
    course_framed: Option<Rect>,
    /// Scene the teaching camera last composed; subsets of it may be held off-centre.
    last_framed_scene: Option<Rect>,
    /// Beat whose request last composed or confirmed `last_framed_scene`.
    last_framed_beat: Option<String>,
}

impl Policy {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    /// The targets the camera last framed (web lastAttentionTargets).
    pub fn last_attention(&self) -> &[String] {
        &self.last_attention
    }
    /// The learner took the camera (web beginManualNavigation).
    pub fn manual_navigation(&mut self) {
        self.last_framed_scene = None;
    }

    /// Web collectFocusRects: targets, group members, connection endpoints,
    /// and the rendered control panel of any anchor among them.
    fn collect_rects(
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

    /// Web resolveFocusRects: the targets' rects, plus the supporting visual
    /// a note explains while both stay readable together.
    pub fn focus_rects(
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        current: Camera,
        view: &View,
    ) -> Vec<Rect> {
        let own = Self::collect_rects(p, layout, targets, view);
        let supporting: Vec<String> = supporting_visuals(p, layout, targets)
            .into_iter()
            .filter(|id| !targets.contains(id))
            .collect();
        if own.is_empty() || supporting.is_empty() {
            return own;
        }
        let all: Vec<String> = targets.iter().chain(&supporting).cloned().collect();
        let with_support = Self::collect_rects(p, layout, &all, view);
        if Self::plan_scale(&with_support, current, view)
            >= Self::plan_scale(&own, current, view) * SUPPORTING_VISUAL_MIN_SCALE_SHARE
        {
            with_support
        } else {
            own
        }
    }

    /// Scale of a plain detail/relationship plan of `rects`.
    fn plan_scale(rects: &[Rect], current: Camera, view: &View) -> f64 {
        let mode = if rects.len() > 1 {
            Mode::Relationship
        } else {
            Mode::Detail
        };
        Self::plan_rects(rects, current, view, mode).scale
    }
    fn plan_rects(rects: &[Rect], current: Camera, view: &View, mode: Mode) -> Camera {
        camera::plan_focus(
            rects,
            current,
            view.width,
            view.height,
            mode,
            view.insets,
            view.scale_floor,
            view.scale_ceiling,
            None,
        )
    }

    /// Web planFocusCamera for a focusRects request: the attention mode
    /// follows what is framed.
    pub fn plan(
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
        Self::plan_rects(rects, current, view, mode)
    }

    /// Web withTeachingContext: adds the current Beat's own targets, then
    /// cards the Step wrote earlier, while the frame stays readable.
    fn with_teaching_context(
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        rects: Vec<Rect>,
        current: Camera,
        view: &View,
    ) -> Vec<Rect> {
        if rects.is_empty() {
            return rects;
        }
        let readable = view.scale_floor.max(CONTEXT_READABLE_SCALE);
        let extend = |base: Vec<Rect>, ids: &[String], share: f64, allow_readable: bool| {
            let extra = Self::focus_rects(p, layout, ids, current, view);
            if extra.is_empty() {
                return base;
            }
            let candidate: Vec<Rect> = base.iter().chain(&extra).copied().collect();
            let scale = Self::plan_scale(&candidate, current, view);
            if scale >= Self::plan_scale(&base, current, view) * share
                || (allow_readable && scale >= readable)
            {
                candidate
            } else {
                base
            }
        };
        let exists = |id: &String| p.nodes.iter().any(|n| n["id"] == id.as_str())
            || p.groups.iter().any(|g| g["id"] == id.as_str())
            || p.connections.iter().any(|c| c["id"] == id.as_str());
        let mut known: Vec<String> = targets.to_vec();
        let beat: Vec<String> = composition_targets(p)
            .into_iter()
            .filter(|id| exists(id) && !known.contains(id))
            .collect();
        known.extend(beat.iter().cloned());
        let mut result = if beat.is_empty() {
            rects
        } else {
            extend(rects, &beat, BEAT_CONTEXT_MIN_SCALE_SHARE, true)
        };
        let step: Vec<String> = p
            .current_beat()
            .map(|b| p.step_context_targets(b))
            .unwrap_or_default()
            .into_iter()
            .filter(|id| !known.contains(id) && p.nodes.iter().any(|n| n["id"] == id.as_str()))
            .collect();
        if !step.is_empty() {
            result = extend(result, &step, STEP_CONTEXT_MIN_SCALE_SHARE, false);
        }
        result
    }

    /// Web focusRects: context, plan, then hold the current frame when it
    /// already shows the scene. None when the camera stays where it is.
    fn focus(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        requested: Vec<Rect>,
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        if !targets.is_empty() {
            self.last_attention = targets.to_vec();
        }
        let requested_count = requested.len();
        let rects = Self::with_teaching_context(p, layout, targets, requested, current, view);
        let planned = Self::plan(p, targets, &rects, current, view);
        if std::env::var_os("OLL_FOCUS_DEBUG").is_some() {
            eprintln!(
                "[focus] cursor {} targets {:?} requested {} -> {} rects {:?} planned {:?} current {:?}",
                p.cursor, targets, requested_count, rects.len(), rects, planned, current
            );
        }
        let scene = Rect::union(&rects, 0.)?;
        let within_frame = self.last_framed_scene.is_some_and(|f| {
            scene.x >= f.x - 1.
                && scene.y >= f.y - 1.
                && scene.x + scene.width <= f.x + f.width + 1.
                && scene.y + scene.height <= f.y + f.height + 1.
        });
        let center_share = if within_frame {
            camera::HOLD_CENTER_SHARE_FRAMED
        } else {
            camera::HOLD_CENTER_SHARE_NEW
        };
        // Within one Beat the composed frame already chose its scale.
        let beat = p.current_beat().map(str::to_owned);
        let same_beat = beat.is_some() && beat == self.last_framed_beat;
        let readable = if within_frame && same_beat {
            0.
        } else {
            f64::INFINITY
        };
        let holds = camera::holds_teaching_frame(
            &rects,
            current,
            planned,
            view.width,
            view.height,
            view.insets,
            center_share,
            readable,
        );
        if holds {
            if !within_frame {
                self.last_framed_scene = Some(scene);
            }
            self.last_framed_beat = beat;
            return None;
        }
        self.last_framed_scene = Some(scene);
        self.last_framed_beat = beat;
        Some(planned)
    }

    fn readable_together(
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        current: Camera,
        view: &View,
    ) -> bool {
        let rects = Self::focus_rects(p, layout, targets, current, view);
        !rects.is_empty()
            && Self::plan_rects(&rects, current, view, Mode::Relationship).scale
                >= ANIMATION_CONTEXT_MIN_SCALE
    }

    /// Host attention request (web focusTargets, e.g. after an outline
    /// seek): frame `targets` through the full focusRects pipeline.
    pub fn focus_targets(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        targets: &[String],
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        let rects = Self::focus_rects(p, layout, targets, current, view);
        if rects.is_empty() {
            return None;
        }
        self.focus(p, layout, targets, rects, current, view)
    }
    /// Web resize(): re-plan the last attention after a viewport change.
    pub fn refocus(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        let targets = if self.last_attention.is_empty() {
            p.focus.clone()
        } else {
            self.last_attention.clone()
        };
        let rects = Self::focus_rects(p, layout, &targets, current, view);
        if rects.is_empty() {
            return None;
        }
        self.focus(p, layout, &targets, rects, current, view)
    }

    /// The camera after rendering the current state, or None when the Web
    /// would leave the camera where it is. `automatic` is false while the
    /// learner has taken manual control (pan/zoom) and no new teaching
    /// operation has arrived.
    ///
    /// `boundary`: the host's current playback operation is a `beat.end` or
    /// `step.commit` (e.g. after advancing a whole Beat) rather than the last
    /// applied action; the Web then refocuses the last attention targets
    /// (cameraFocusTargets) instead of the action's own targets.
    pub fn render(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        current: Camera,
        view: &View,
        boundary: bool,
    ) -> Option<Camera> {
        let operation = if boundary {
            None
        } else {
            p.cursor.checked_sub(1).and_then(|i| p.frame_action(i))
        };
        let new_operation = self.rendered_cursor != Some(p.cursor);
        let animating = p.animating();
        let beat = p.current_beat().map(str::to_owned).unwrap_or_default();
        let composition = composition_targets(p);
        let composition_key = format!("{beat}\u{0}{}", composition.join("\u{0}"));
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
        let mut apply = |policy: &mut Self, targets: &[String], rects: Vec<Rect>, camera: &mut Camera| {
            if let Some(to) = policy.focus(p, layout, targets, rects, *camera, view) {
                *camera = to;
                moved = true;
            }
        };
        if new_operation && boundary {
            let targets = if self.last_attention.is_empty() {
                p.focus.clone()
            } else {
                self.last_attention.clone()
            };
            let rects = Self::focus_rects(p, layout, &targets, camera, view);
            if !rects.is_empty() {
                apply(self, &targets, rects, &mut camera);
            }
        }
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
                    let outside: Vec<String> = composition
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
                            composition.clone()
                        }
                    }
                };
                let rects = Self::focus_rects(p, layout, &requested, camera, view);
                if !rects.is_empty() {
                    apply(self, &requested, rects, &mut camera);
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
                        // Resolve the card exactly as an explicit focus would.
                        let targets = vec![id.to_owned()];
                        let mut rects = Self::focus_rects(p, layout, &targets, camera, view);
                        if rects.is_empty() {
                            rects.extend(target_rect(p, layout, id));
                        }
                        if !rects.is_empty() {
                            apply(self, &targets, rects, &mut camera);
                        }
                    }
                }
            }
        }

        // 2. Host composition (planHostTeachingFocus), applied after the view.
        let host_targets = if animating {
            None
        } else if animation_ended && !composition.is_empty() {
            Some(composition.clone())
        } else if !composition.is_empty() && (composition_changed || composition_operation_changed)
        {
            Some(composition.clone())
        } else {
            None
        };
        if let Some(targets) = host_targets {
            let rects = Self::focus_rects(p, layout, &targets, camera, view);
            if !rects.is_empty() {
                apply(self, &targets, rects, &mut camera);
            }
        }

        self.rendered_cursor = Some(p.cursor);
        self.rendered_composition = composition_key;
        self.animation_was_active = animating;
        moved.then_some(camera)
    }

    /// octos-learn course-end overview: once playback completes, frame every
    /// course card and host panel in "course" mode (a navigation boundary,
    /// small margin, no readability floor); the cards are the `parts` that
    /// floating UI must not cover. Returns a camera whenever the framed
    /// bounds change (e.g. a reflection card was measured or opened).
    pub fn course_end(
        &mut self,
        p: &Preview,
        layout: &BoardLayout,
        current: Camera,
        view: &View,
    ) -> Option<Camera> {
        if !p.complete() {
            self.course_framed = None;
            return None;
        }
        let rects: Vec<Rect> = layout
            .nodes
            .values()
            .chain(layout.attachments.values())
            .copied()
            .collect();
        let bounds = Rect::union(&rects, 0.)?;
        if self.course_framed == Some(bounds) {
            return None;
        }
        self.course_framed = Some(bounds);
        self.last_framed_scene = None;
        Some(camera::plan_focus(
            &[bounds],
            current,
            view.width,
            view.height,
            Mode::Course,
            view.insets,
            view.scale_floor,
            view.scale_ceiling,
            Some(&rects),
        ))
    }
}

/// Web compositionTargets: the current Beat's focus targets plus the cards it
/// has created so far.
pub fn composition_targets(p: &Preview) -> Vec<String> {
    let Some(beat) = p.current_beat() else {
        return vec![];
    };
    let mut out = p.beat_focus_targets(beat);
    for id in p.beat_created(beat) {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
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
