//! Platform-independent stroke state for the native service integration slice.
//! Native samples retain x/y/pressure/time; host camera conversion happens at stroke start.
use crate::spatial::Camera;
use serde_json::{json, Value};
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub x: f64,
    pub y: f64,
    pub pressure: f64,
    pub time: f64,
}
#[derive(Clone, Debug)]
pub struct Stroke {
    pub id: u64,
    pub width: f64,
    pub points: Vec<Sample>,
}
/// One undoable ink edit (web js-draw commands: add, erase, transform).
#[derive(Clone, Debug)]
enum Edit {
    Add(Stroke),
    /// Strokes removed with their original indices (ascending).
    Erase(Vec<(usize, Stroke)>),
    Move { ids: Vec<u64>, dx: f64, dy: f64 },
}
#[derive(Clone, Debug, Default)]
pub struct Ink {
    pub strokes: Vec<Stroke>,
    history: Vec<Edit>,
    undone: Vec<Edit>,
    active: Option<(Stroke, Camera, (f64, f64))>,
    /// Strokes erased by the current eraser drag (one undo step).
    erasing: Option<Vec<(usize, Stroke)>>,
    /// Selected stroke ids (web selection tool).
    pub selection: Vec<u64>,
    /// Offset applied to the selection by an in-progress drag.
    moving: Option<(f64, f64)>,
}

fn segment_distance(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 > 0. { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0., 1.) } else { 0. };
    ((p.0 - a.0 - t * dx).powi(2) + (p.1 - a.1 - t * dy).powi(2)).sqrt()
}
impl Stroke {
    /// Whether the stroke passes within `radius` of a world point.
    pub fn hits(&self, x: f64, y: f64, radius: f64) -> bool {
        let r = radius + self.width / 2.;
        match self.points.as_slice() {
            [] => false,
            [p] => ((p.x - x).powi(2) + (p.y - y).powi(2)).sqrt() <= r,
            pts => pts.windows(2).any(|w| segment_distance((x, y), (w[0].x, w[0].y), (w[1].x, w[1].y)) <= r),
        }
    }
    /// Bounding box (x, y, width, height).
    pub fn bounds(&self) -> Option<(f64, f64, f64, f64)> {
        let first = self.points.first()?;
        let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.x, first.y);
        for p in &self.points {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        let h = self.width / 2.;
        Some((x0 - h, y0 - h, x1 - x0 + 2. * h, y1 - y0 + 2. * h))
    }
    fn translate(&mut self, dx: f64, dy: f64) {
        for p in &mut self.points {
            p.x += dx;
            p.y += dy;
        }
    }
}
impl Ink {
    pub fn batch(
        &mut self,
        batch: &Value,
        camera: Camera,
        origin: (f64, f64),
    ) -> Result<Option<u64>, String> {
        let action = batch["action"].as_str().ok_or("Missing ink action")?;
        let id = batch["pointerId"].as_u64().ok_or("Missing stroke id")?;
        if action == "cancel" {
            if self.active.as_ref().is_some_and(|(s, _, _)| s.id == id) {
                self.active = None;
            }
            return Ok(None);
        }
        if !matches!(action, "down" | "move" | "up") {
            return Err("Unsupported ink action".into());
        }
        let mut next = self.clone();
        if action == "down" {
            if next.active.is_some() || next.strokes.iter().any(|s| s.id == id) {
                return Err("Conflicting stroke id".into());
            }
            if !camera.scale.is_finite() || camera.scale <= 0. {
                return Err("Invalid ink camera".into());
            }
            next.active = Some((
                Stroke {
                    id,
                    width: 3. / camera.scale,
                    points: vec![],
                },
                camera,
                origin,
            ));
        }
        let (stroke, camera, origin) = next
            .active
            .as_mut()
            .ok_or("Ink event without active stroke")?;
        if stroke.id != id {
            return Err("Ink pointer mismatch".into());
        }
        let points = batch["points"].as_array().ok_or("Missing samples")?;
        if stroke.points.len() + points.len() > 100_000 {
            return Err("Stroke sample budget exceeded".into());
        }
        for p in points {
            let value = |k: &str| {
                p[k].as_f64()
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| format!("Invalid sample {k}"))
            };
            let (x, y) = camera.view_to_world(value("x")? - origin.0, value("y")? - origin.1);
            let time = value("time")?;
            let sample = Sample {
                x,
                y,
                time,
                pressure: value("pressure")?,
            };
            if stroke.points.last().is_some_and(|p| time <= p.time) {
                continue;
            }
            stroke.points.push(sample);
        }
        let committed = if action == "up" {
            let (stroke, _, _) = next.active.take().unwrap();
            if stroke.points.is_empty() {
                return Err("Empty stroke".into());
            }
            next.strokes.push(stroke.clone());
            next.history.push(Edit::Add(stroke));
            next.undone.clear();
            Some(id)
        } else {
            None
        };
        *self = next;
        Ok(committed)
    }
    pub fn active_points(&self) -> Option<&[Sample]> {
        self.active.as_ref().map(|(s, _, _)| s.points.as_slice())
    }
    fn apply(&mut self, edit: &Edit, forward: bool) {
        match (edit, forward) {
            (Edit::Add(s), true) => self.strokes.push(s.clone()),
            (Edit::Add(s), false) => self.strokes.retain(|x| x.id != s.id),
            (Edit::Erase(list), true) => {
                let ids: Vec<u64> = list.iter().map(|(_, s)| s.id).collect();
                self.strokes.retain(|x| !ids.contains(&x.id));
                self.selection.retain(|id| !ids.contains(id));
            }
            (Edit::Erase(list), false) => {
                for (index, s) in list {
                    let i = (*index).min(self.strokes.len());
                    self.strokes.insert(i, s.clone());
                }
            }
            (Edit::Move { ids, dx, dy }, forward) => {
                let k = if forward { 1. } else { -1. };
                for s in self.strokes.iter_mut().filter(|s| ids.contains(&s.id)) {
                    s.translate(dx * k, dy * k);
                }
            }
        }
    }
    pub fn undo(&mut self) {
        self.finish_erase();
        if let Some(edit) = self.history.pop() {
            self.apply(&edit, false);
            self.undone.push(edit);
        }
    }
    pub fn redo(&mut self) {
        if let Some(edit) = self.undone.pop() {
            self.apply(&edit, true);
            self.history.push(edit);
        }
    }
    fn record(&mut self, edit: Edit) {
        self.history.push(edit);
        self.undone.clear();
    }
    /// Eraser (web js-draw eraser, whole strokes): remove every stroke the
    /// eraser touches at (x, y); one drag is one undo step.
    pub fn erase_at(&mut self, x: f64, y: f64, radius: f64) -> bool {
        let mut removed = Vec::new();
        let mut index = 0;
        while index < self.strokes.len() {
            if self.strokes[index].hits(x, y, radius) {
                let s = self.strokes.remove(index);
                self.selection.retain(|id| *id != s.id);
                // Original index accounting for strokes removed earlier in this drag.
                removed.push((index, s));
            } else {
                index += 1;
            }
        }
        if removed.is_empty() {
            return false;
        }
        self.erasing.get_or_insert_with(Vec::new).extend(removed);
        true
    }
    /// End the current eraser drag (records its undo step).
    pub fn finish_erase(&mut self) {
        if let Some(mut list) = self.erasing.take() {
            // Each index is relative to the strokes left after the earlier
            // removals: re-inserting in reverse removal order restores them.
            list.reverse();
            self.record(Edit::Erase(list));
        }
    }
    /// Select the strokes whose bounds intersect a world rect (marquee).
    pub fn select_rect(&mut self, x: f64, y: f64, w: f64, h: f64) {
        let (x0, y0, x1, y1) = (x.min(x + w), y.min(y + h), x.max(x + w), y.max(y + h));
        self.selection = self
            .strokes
            .iter()
            .filter(|s| s.points.iter().any(|p| p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1))
            .map(|s| s.id)
            .collect();
    }
    pub fn select_all(&mut self) {
        self.selection = self.strokes.iter().map(|s| s.id).collect();
    }
    pub fn clear_selection(&mut self) {
        self.commit_move();
        self.selection.clear();
    }
    /// Bounds of the selection (x, y, width, height), including a live move.
    pub fn selection_bounds(&self) -> Option<(f64, f64, f64, f64)> {
        let (dx, dy) = self.moving.unwrap_or((0., 0.));
        let boxes: Vec<_> = self
            .strokes
            .iter()
            .filter(|s| self.selection.contains(&s.id))
            .filter_map(Stroke::bounds)
            .collect();
        let x0 = boxes.iter().map(|b| b.0).fold(f64::INFINITY, f64::min);
        let y0 = boxes.iter().map(|b| b.1).fold(f64::INFINITY, f64::min);
        let x1 = boxes.iter().map(|b| b.0 + b.2).fold(f64::NEG_INFINITY, f64::max);
        let y1 = boxes.iter().map(|b| b.1 + b.3).fold(f64::NEG_INFINITY, f64::max);
        (!boxes.is_empty()).then(|| (x0 + dx, y0 + dy, x1 - x0, y1 - y0))
    }
    /// Live offset of the selection while it is dragged.
    pub fn move_selection(&mut self, dx: f64, dy: f64) {
        if !self.selection.is_empty() {
            self.moving = Some((dx, dy));
        }
    }
    pub fn moving_offset(&self) -> (f64, f64) {
        self.moving.unwrap_or((0., 0.))
    }
    /// Commit a selection drag as one undo step.
    pub fn commit_move(&mut self) {
        let Some((dx, dy)) = self.moving.take() else { return };
        if dx.abs() < 1e-9 && dy.abs() < 1e-9 {
            return;
        }
        let edit = Edit::Move { ids: self.selection.clone(), dx, dy };
        self.apply(&edit, true);
        self.record(edit);
    }
    /// Delete the selected strokes (one undo step).
    pub fn delete_selection(&mut self) -> bool {
        self.commit_move();
        let list: Vec<(usize, Stroke)> = self
            .strokes
            .iter()
            .enumerate()
            .filter(|(_, s)| self.selection.contains(&s.id))
            .map(|(i, s)| (i, s.clone()))
            .collect();
        if list.is_empty() {
            return false;
        }
        let edit = Edit::Erase(list);
        self.apply(&edit, true);
        self.record(edit);
        self.selection.clear();
        true
    }
    /// Restore saved strokes (snapshot shape); the undo history starts empty.
    pub fn restore(&mut self, saved: &Value) {
        self.strokes = saved["strokes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| {
                Some(Stroke {
                    id: s["id"].as_u64()?,
                    width: s["width"].as_f64()?,
                    points: s["points"]
                        .as_array()?
                        .iter()
                        .filter_map(|p| {
                            Some(Sample {
                                x: p["x"].as_f64()?,
                                y: p["y"].as_f64()?,
                                pressure: p["pressure"].as_f64().unwrap_or(0.5),
                                time: p["time"].as_f64().unwrap_or(0.),
                            })
                        })
                        .collect(),
                })
            })
            .filter(|s| !s.points.is_empty())
            .collect();
        self.history.clear();
        self.undone.clear();
        self.selection.clear();
    }
    pub fn can_undo(&self) -> bool {
        !self.history.is_empty() || self.erasing.is_some()
    }
    pub fn can_redo(&self) -> bool {
        !self.undone.is_empty()
    }
    pub fn cancel(&mut self) {
        self.active = None;
    }
    pub fn snapshot(&self) -> Value {
        json!({"strokes":self.strokes.iter().map(|s|json!({"id":s.id,"width":s.width,"points":s.points.iter().map(|p|json!({"x":p.x,"y":p.y,"pressure":p.pressure,"time":p.time})).collect::<Vec<_>>()})).collect::<Vec<_>>()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stroke(id: u64, x: f64) -> Stroke {
        Stroke { id, width: 2., points: vec![Sample { x, y: 0., pressure: 0.5, time: 0. }, Sample { x: x + 10., y: 0., pressure: 0.5, time: 1. }] }
    }
    #[test]
    fn erase_move_delete_undo_and_redo() {
        let mut ink = Ink::default();
        for (i, x) in [0., 100., 200.].into_iter().enumerate() {
            let s = stroke(i as u64 + 1, x);
            ink.strokes.push(s.clone());
            ink.record(Edit::Add(s));
        }
        // One eraser drag touching strokes 1 and 3.
        assert!(ink.erase_at(5., 0., 2.));
        assert!(ink.erase_at(205., 0., 2.));
        ink.finish_erase();
        assert_eq!(ink.strokes.iter().map(|s| s.id).collect::<Vec<_>>(), vec![2]);
        ink.undo();
        assert_eq!(ink.strokes.iter().map(|s| s.id).collect::<Vec<_>>(), vec![1, 2, 3]);
        ink.redo();
        assert_eq!(ink.strokes.len(), 1);
        ink.undo();
        // Select and move stroke 2, then delete it.
        ink.select_rect(90., -5., 30., 10.);
        assert_eq!(ink.selection, vec![2]);
        ink.move_selection(5., 7.);
        ink.commit_move();
        assert_eq!(ink.strokes[1].points[0].x, 105.);
        ink.undo();
        assert_eq!(ink.strokes[1].points[0].x, 100.);
        ink.select_all();
        assert!(ink.delete_selection());
        assert!(ink.strokes.is_empty());
        ink.undo();
        assert_eq!(ink.strokes.iter().map(|s| s.id).collect::<Vec<_>>(), vec![1, 2, 3]);
        let saved = ink.snapshot();
        let mut restored = Ink::default();
        restored.restore(&saved);
        assert_eq!(restored.strokes.len(), 3);
    }
}
