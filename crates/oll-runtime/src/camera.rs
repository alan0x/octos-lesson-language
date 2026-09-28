//! Teaching camera planning ported from packages/web-runtime/src/camera.ts:
//! safe viewport (insets, focus margin, floating-UI occlusions with the
//! sliver filter and near-fit/centered candidate choice), planFocusCamera
//! per attention mode, and planRevealCamera.
use crate::spatial::{Camera, Rect};

const FOCUS_MARGIN: f64 = 70.;
const REVEAL_MARGIN: f64 = FOCUS_MARGIN;
const MIN_READABLE_FOCUS_WIDTH: f64 = 240.;
pub const MIN_AUTOMATIC_SCALE: f64 = 0.18;
const MAX_AUTOMATIC_SCALE: f64 = 1.3;
const MIN_OCCLUSION_OVERLAP: f64 = 8.;
const NEAR_FIT_RATIO: f64 = 0.85;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Detail,
    Relationship,
    Overview,
    Course,
}
impl Mode {
    fn composition_target(self) -> f64 {
        match self {
            Mode::Detail => 0.78,
            Mode::Relationship => 0.85,
            Mode::Overview => 0.88,
            Mode::Course => 1.,
        }
    }
}

/// Web ViewportInsets: bands, optional focus margin, occluding host UI in
/// viewport-local pixels.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
    pub focus_margin: Option<f64>,
    pub occlusions: Vec<Rect>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Safe {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}
impl Safe {
    pub fn width(&self) -> f64 {
        self.right - self.left
    }
    pub fn height(&self) -> f64 {
        self.bottom - self.top
    }
}

fn inset(v: f64) -> f64 {
    if v.is_finite() {
        v.max(0.)
    } else {
        0.
    }
}
fn focus_margin(insets: &Insets) -> f64 {
    insets
        .focus_margin
        .filter(|m| m.is_finite())
        .map_or(FOCUS_MARGIN, |m| m.max(0.))
}

/// Web safeViewport.
pub fn safe_viewport(
    width: f64,
    height: f64,
    insets: &Insets,
    margin: f64,
    content: Option<Rect>,
    near_fit_ratio: f64,
) -> Safe {
    let mut base = Safe {
        left: inset(insets.left) + margin,
        top: inset(insets.top) + margin,
        right: width - inset(insets.right) - margin,
        bottom: height - inset(insets.bottom) - margin,
    };
    base.right = base.right.max(base.left + 1.);
    base.bottom = base.bottom.max(base.top + 1.);
    let occlusions: Vec<Safe> = insets
        .occlusions
        .iter()
        .filter_map(|o| {
            if ![o.x, o.y, o.width, o.height].iter().all(|v| v.is_finite())
                || o.width <= 0.
                || o.height <= 0.
            {
                return None;
            }
            let ow = base.right.min(o.x + o.width) - base.left.max(o.x);
            let oh = base.bottom.min(o.y + o.height) - base.top.max(o.y);
            if ow < MIN_OCCLUSION_OVERLAP || oh < MIN_OCCLUSION_OVERLAP {
                return None;
            }
            let r = Safe {
                left: base.left.max(o.x - margin),
                top: base.top.max(o.y - margin),
                right: base.right.min(o.x + o.width + margin),
                bottom: base.bottom.min(o.y + o.height + margin),
            };
            (r.right > r.left && r.bottom > r.top).then_some(r)
        })
        .collect();
    if occlusions.is_empty() {
        return base;
    }
    let dedup = |mut v: Vec<f64>| {
        let mut out: Vec<f64> = Vec::new();
        for x in v.drain(..) {
            if !out.contains(&x) {
                out.push(x);
            }
        }
        out
    };
    let xs = dedup(
        [base.left, base.right]
            .into_iter()
            .chain(occlusions.iter().flat_map(|o| [o.left, o.right]))
            .collect(),
    );
    let ys = dedup(
        [base.top, base.bottom]
            .into_iter()
            .chain(occlusions.iter().flat_map(|o| [o.top, o.bottom]))
            .collect(),
    );
    struct Candidate {
        r: Safe,
        area: f64,
        fit: f64,
    }
    let mut candidates = Vec::new();
    for &left in &xs {
        for &right in &xs {
            for &top in &ys {
                for &bottom in &ys {
                    if right <= left || bottom <= top {
                        continue;
                    }
                    if occlusions.iter().any(|o| {
                        left < o.right && right > o.left && top < o.bottom && bottom > o.top
                    }) {
                        continue;
                    }
                    let (w, h) = (right - left, bottom - top);
                    let area = w * h;
                    let fit = match content {
                        Some(c) => MAX_AUTOMATIC_SCALE
                            .min(w / c.width.max(1.))
                            .min(h / c.height.max(1.)),
                        None => area,
                    };
                    candidates.push(Candidate {
                        r: Safe {
                            left,
                            top,
                            right,
                            bottom,
                        },
                        area,
                        fit,
                    });
                }
            }
        }
    }
    if candidates.is_empty() {
        return base;
    }
    let best_fit = candidates
        .iter()
        .map(|c| c.fit)
        .fold(f64::NEG_INFINITY, f64::max);
    let cx = (base.left + base.right) / 2.;
    let cy = (base.top + base.bottom) / 2.;
    let mut best = candidates[0].r;
    let mut best_distance = f64::INFINITY;
    let mut best_area = -1.;
    for c in &candidates {
        if c.fit + 0.000001 < best_fit * near_fit_ratio {
            continue;
        }
        let distance = (c.r.left + c.r.width() / 2. - cx).hypot(c.r.top + c.r.height() / 2. - cy);
        if distance < best_distance - 0.5
            || ((distance - best_distance).abs() <= 0.5 && c.area > best_area)
        {
            best = c.r;
            best_distance = distance;
            best_area = c.area;
        }
    }
    best
}

fn visible_at(
    rect: Rect,
    camera: Camera,
    width: f64,
    height: f64,
    margin: f64,
    insets: &Insets,
) -> bool {
    let safe = safe_viewport(width, height, insets, margin, Some(rect), NEAR_FIT_RATIO);
    let left = camera.x + rect.x * camera.scale;
    let right = left + rect.width * camera.scale;
    let top = camera.y + rect.y * camera.scale;
    let bottom = top + rect.height * camera.scale;
    left >= safe.left && right <= safe.right && top >= safe.top && bottom <= safe.bottom
}
fn centered(rect: Rect, scale: f64, width: f64, height: f64, insets: &Insets, near: f64) -> Camera {
    let safe = safe_viewport(
        width,
        height,
        insets,
        focus_margin(insets),
        Some(rect),
        near,
    );
    Camera {
        scale,
        x: safe.left + safe.width() / 2. - (rect.x + rect.width / 2.) * scale,
        y: safe.top + safe.height() / 2. - (rect.y + rect.height / 2.) * scale,
    }
}
fn composed_at(rect: Rect, camera: Camera, width: f64, height: f64, insets: &Insets) -> bool {
    let safe = safe_viewport(
        width,
        height,
        insets,
        focus_margin(insets),
        Some(rect),
        NEAR_FIT_RATIO,
    );
    let sx = camera.x + (rect.x + rect.width / 2.) * camera.scale;
    let sy = camera.y + (rect.y + rect.height / 2.) * camera.scale;
    (sx - (safe.left + safe.width() / 2.)).abs() < 1.
        && (sy - (safe.top + safe.height() / 2.)).abs() < 1.
}

/// Web planFocusCamera: the scale follows target geometry and viewport so
/// the complete teaching scene stays readable and takes a deliberate share.
pub fn plan_focus(
    targets: &[Rect],
    current: Camera,
    width: f64,
    height: f64,
    mode: Mode,
    insets: &Insets,
    automatic_scale_floor: f64,
) -> Camera {
    let Some(scene) = Rect::union(targets, 0.) else {
        return current;
    };
    let mut insets = insets.clone();
    if mode == Mode::Course {
        insets.focus_margin = Some(insets.focus_margin.unwrap_or(24.));
    }
    let margin = focus_margin(&insets);
    let near = if mode == Mode::Course {
        1.
    } else {
        NEAR_FIT_RATIO
    };
    let safe = safe_viewport(width, height, &insets, margin, Some(scene), near);
    let scale_floor = match mode {
        Mode::Course => 0.,
        Mode::Relationship => MIN_AUTOMATIC_SCALE,
        _ => MAX_AUTOMATIC_SCALE.min(MIN_AUTOMATIC_SCALE.max(automatic_scale_floor)),
    };
    let fit_scale = MAX_AUTOMATIC_SCALE.min(
        scale_floor
            .max((safe.width() / scene.width.max(1.)).min(safe.height() / scene.height.max(1.))),
    );
    let extent = (scene.width / safe.width()).max(scene.height / safe.height());
    let composition_scale = mode.composition_target() / extent.max(0.001);
    let readable = targets
        .iter()
        .map(|r| MIN_READABLE_FOCUS_WIDTH / r.width.max(1.))
        .fold(f64::NEG_INFINITY, f64::max);
    let scale = fit_scale.min(scale_floor.max(readable).max(composition_scale));
    if (scale - current.scale).abs() < 0.000_001
        && visible_at(scene, current, width, height, margin, &insets)
        && composed_at(scene, current, width, height, &insets)
    {
        return current;
    }
    centered(scene, scale, width, height, &insets, near)
}

/// Web planRevealCamera: minimal pan that brings `rect` into the safe area.
pub fn plan_reveal(
    rect: Rect,
    current: Camera,
    width: f64,
    height: f64,
    insets: &Insets,
) -> Camera {
    if visible_at(rect, current, width, height, REVEAL_MARGIN, insets) {
        return current;
    }
    let safe = safe_viewport(
        width,
        height,
        insets,
        REVEAL_MARGIN,
        Some(rect),
        NEAR_FIT_RATIO,
    );
    let (mut x, mut y) = (current.x, current.y);
    let left = x + rect.x * current.scale;
    let right = left + rect.width * current.scale;
    let top = y + rect.y * current.scale;
    let bottom = top + rect.height * current.scale;
    if left < safe.left {
        x += safe.left - left;
    } else if right > safe.right {
        x -= right - safe.right;
    }
    if top < safe.top {
        y += safe.top - top;
    } else if bottom > safe.bottom {
        y -= bottom - safe.bottom;
    }
    Camera {
        x,
        y,
        scale: current.scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn sliver_occlusions_are_ignored_and_real_ones_move_the_safe_area() {
        let mut insets = Insets {
            top: 92.,
            right: 28.,
            bottom: 120.,
            left: 28.,
            ..Default::default()
        };
        let base = safe_viewport(1440., 900., &insets, 70., None, NEAR_FIT_RATIO);
        assert_eq!(
            base,
            Safe {
                left: 98.,
                top: 162.,
                right: 1342.,
                bottom: 710.
            }
        );
        insets.occlusions = vec![r(0., 708., 1440., 20.)];
        assert_eq!(
            safe_viewport(1440., 900., &insets, 70., None, NEAR_FIT_RATIO),
            base
        );
        insets.occlusions = vec![r(0., 150., 400., 200.)];
        let moved = safe_viewport(
            1440.,
            900.,
            &insets,
            70.,
            Some(r(0., 0., 400., 300.)),
            NEAR_FIT_RATIO,
        );
        assert!(moved.left >= 470. || moved.top >= 420.);
    }
    #[test]
    fn focus_centers_the_scene_in_the_safe_area_and_is_idempotent() {
        let insets = Insets {
            top: 92.,
            right: 28.,
            bottom: 120.,
            left: 28.,
            ..Default::default()
        };
        let scene = [r(100., 100., 460., 360.)];
        let cam = plan_focus(
            &scene,
            Camera::default(),
            1440.,
            900.,
            Mode::Detail,
            &insets,
            0.18,
        );
        // Safe area 1244 x 548: fit = min(1244/460, 548/360) = 1.522 -> capped 1.3;
        // composition 0.78 / (360/548) = 1.187 wins.
        assert!((cam.scale - 0.78 / (360. / 548.)).abs() < 1e-9);
        let again = plan_focus(&scene, cam, 1440., 900., Mode::Detail, &insets, 0.18);
        assert_eq!(again, cam);
        let reveal = plan_reveal(scene[0], cam, 1440., 900., &insets);
        assert_eq!(reveal, cam);
    }
}
