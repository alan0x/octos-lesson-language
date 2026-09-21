//! Shared estimated-narration scheduler. Host supplies monotonic elapsed seconds.
//! Core action coverage is still limited to the supported Preview slice.
use crate::{
    preview::Preview,
    timing::{narration_ms, operation_ms},
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub fn compile_operations(source: &str) -> Result<Vec<Value>, String> {
    let events: Vec<Value> = source
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    // Reuse the supported-action validation, including envelope ordering.
    Preview::load(source)?;
    let lesson_id = &events[0]["lesson_id"];
    let mut ops = Vec::new();
    let mut push = |mut op: Value| {
        op["lesson_id"] = lesson_id.clone();
        op["operation_id"] = json!(format!("playback:{:06}", ops.len() + 1));
        ops.push(op);
    };
    let mut steps = BTreeSet::new();
    let mut beats = BTreeSet::new();
    push(json!({"type":"lesson.open","event_index":0}));
    for (index, event) in events.iter().enumerate().skip(1) {
        if event["event"] == "lesson.close" {
            push(json!({"type":"lesson.close","event_index":index}));
            continue;
        }
        let step = &event["step"];
        let step_id = step["id"].as_str().ok_or("Missing step id")?;
        if !steps.insert(step_id) {
            return Err("Duplicate step id".into());
        }
        push(json!({"type":"step.begin","event_index":index,"step_id":step_id}));
        for beat in step["beats"].as_array().ok_or("Missing beats")? {
            let beat_id = beat["id"].as_str().ok_or("Missing beat id")?;
            if !beats.insert(beat_id) {
                return Err("Duplicate beat id".into());
            }
            let base = json!({"event_index":index,"step_id":step_id,"beat_id":beat_id});
            let with_type = |kind: &str| {
                let mut v = base.clone();
                v["type"] = json!(kind);
                v
            };
            push(with_type("beat.begin"));
            for phase in ["before_speech", "during_speech", "after_speech"] {
                let narrated = phase == "during_speech" && !beat["narration"].is_null();
                if narrated {
                    let mut v = with_type("narration.begin");
                    v["narration"] = beat["narration"].clone();
                    push(v);
                }
                let mut v = with_type("phase.begin");
                v["phase"] = json!(phase);
                push(v);
                for a in beat["stage"][phase]
                    .as_array()
                    .ok_or("Missing phase actions")?
                {
                    let mut v = with_type("action.apply");
                    v["phase"] = json!(phase);
                    v["action"] = a.clone();
                    push(v);
                }
                let mut v = with_type("phase.end");
                v["phase"] = json!(phase);
                push(v);
                if narrated {
                    let mut v = with_type("narration.end");
                    v["narration"] = beat["narration"].clone();
                    push(v);
                }
            }
            push(with_type("beat.end"));
        }
        push(json!({"type":"step.commit","event_index":index,"step_id":step_id}));
    }
    Ok(ops)
}
#[derive(Clone, Debug)]
pub struct Session {
    pub board: Preview,
    pub operations: Vec<Value>,
    pub cursor: usize,
    pub playing: bool,
    pub current_phase: Option<String>,
    pub committed_steps: Vec<String>,
    wait_ms: f64,
    narration_remaining_ms: f64,
    narration: String,
    final_focus: Vec<String>,
}
impl Session {
    pub fn load(source: &str) -> Result<Self, String> {
        let operations = compile_operations(source)?;
        let last: Value = serde_json::from_str(
            source
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .ok_or("Empty lesson")?,
        )
        .map_err(|e| e.to_string())?;
        let final_focus = last["result"]["suggested_focus"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .ok_or("Invalid final focus".to_owned())
            })
            .collect::<Result<_, _>>()?;
        Ok(Self {
            board: Preview::load(source)?,
            operations,
            cursor: 0,
            playing: false,
            current_phase: None,
            committed_steps: Vec::new(),
            wait_ms: 0.0,
            narration_remaining_ms: 0.0,
            narration: String::new(),
            final_focus,
        })
    }
    pub fn complete(&self) -> bool {
        self.cursor == self.operations.len()
    }
    pub fn play(&mut self) -> Result<(), String> {
        if !self.complete() {
            self.playing = true;
            self.tick(0.0)?;
        }
        Ok(())
    }
    pub fn pause(&mut self) {
        self.playing = false;
    }
    pub fn tick(&mut self, seconds: f64) -> Result<(), String> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err("Invalid elapsed time".into());
        }
        if !self.playing {
            return Ok(());
        }
        let result = self.advance_time(seconds * 1000.0);
        if result.is_err() {
            self.playing = false;
        }
        result
    }
    fn advance_time(&mut self, mut budget: f64) -> Result<(), String> {
        loop {
            if self.board.animating() {
                let consumed = budget.min(self.board.animation_remaining() * 1000.0);
                self.board.tick(consumed / 1000.0)?;
                budget = (budget - consumed).max(0.0);
                if self.board.animating() {
                    return Ok(());
                }
                // Preserve existing web runtime behavior: animation time is not
                // deducted from the estimated narration budget. See compatibility log.
                self.wait_ms = 180.0;
            }
            if self.wait_ms > 0.0 {
                let consumed = budget.min(self.wait_ms);
                self.wait_ms = (self.wait_ms - consumed).max(0.0);
                self.narration_remaining_ms = (self.narration_remaining_ms - consumed).max(0.0);
                budget = (budget - consumed).max(0.0);
                if self.wait_ms > 1e-8 {
                    return Ok(());
                }
                self.wait_ms = 0.0;
            }
            if self.complete() {
                self.playing = false;
                return Ok(());
            }
            let op = self.operations[self.cursor].clone();
            let kind = op["type"].as_str().ok_or("Invalid operation")?;
            if kind == "narration.end" && self.narration_remaining_ms > 1e-8 {
                self.wait_ms = self.narration_remaining_ms;
                continue;
            }
            match kind {
                "action.apply" => self.board.advance()?,
                "phase.begin" => self.current_phase = op["phase"].as_str().map(str::to_owned),
                "phase.end" => self.current_phase = None,
                "narration.begin" => {
                    self.narration = op["narration"]["text"]
                        .as_str()
                        .ok_or("Missing narration text")?
                        .into();
                    self.narration_remaining_ms = narration_ms(
                        &self.narration,
                        op["narration"]["delivery"].as_str().unwrap_or(""),
                    );
                }
                "narration.end" | "beat.end" => {
                    self.narration.clear();
                    self.narration_remaining_ms = 0.0;
                }
                "step.commit" => self
                    .committed_steps
                    .push(op["step_id"].as_str().unwrap().into()),
                "lesson.close" => {
                    for target in &self.final_focus {
                        self.board.require_focus(target)?;
                    }
                    self.board.focus = self.final_focus.clone();
                }
                _ => (),
            }
            self.board.narration = self.narration.clone();
            self.cursor += 1;
            if self.complete() {
                self.playing = false;
                return Ok(());
            }
            if !self.board.animating() {
                self.wait_ms = operation_ms(&op);
            }
        }
    }
}
