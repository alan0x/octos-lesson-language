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
#[derive(Clone, Debug, Default)]
pub struct Ink {
    pub strokes: Vec<Stroke>,
    pub redo: Vec<Stroke>,
    active: Option<(Stroke, Camera, (f64, f64))>,
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
            next.strokes.push(stroke);
            next.redo.clear();
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
    pub fn undo(&mut self) {
        if let Some(s) = self.strokes.pop() {
            self.redo.push(s);
        }
    }
    pub fn redo(&mut self) {
        if let Some(s) = self.redo.pop() {
            self.strokes.push(s);
        }
    }
    pub fn cancel(&mut self) {
        self.active = None;
    }
    pub fn snapshot(&self) -> Value {
        json!({"strokes":self.strokes.iter().map(|s|json!({"id":s.id,"width":s.width,"points":s.points.iter().map(|p|json!({"x":p.x,"y":p.y,"pressure":p.pressure,"time":p.time})).collect::<Vec<_>>()})).collect::<Vec<_>>()})
    }
}
