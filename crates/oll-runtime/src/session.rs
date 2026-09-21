//! Shared estimated-narration scheduler. Host supplies monotonic elapsed seconds.
//! Core action coverage is still limited to the supported Preview slice.
use crate::{
    preview::Preview,
    timing::{narration_ms, operation_ms},
};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub fn compile_operations(source: &str) -> Result<Vec<Value>, String> {
    compile_incremental(source, false)
}
fn compile_incremental(source: &str, allow_incomplete: bool) -> Result<Vec<Value>, String> {
    let events: Vec<Value> = source
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    // Reuse the supported-action validation, including envelope ordering.
    Preview::load_incremental(source, allow_incomplete)?;
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
    source: String,
    closed: bool,
}
impl Session {
    pub fn load(source: &str) -> Result<Self, String> {
        Self::load_incremental(source, false)
    }
    pub fn load_incremental(source: &str, allow_incomplete: bool) -> Result<Self, String> {
        let operations = compile_incremental(source, allow_incomplete)?;
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
            board: Preview::load_incremental(source, allow_incomplete)?,
            source: source.into(),
            closed: last["event"] == "lesson.close",
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
        self.closed && self.cursor == self.operations.len()
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
    fn apply_operation(&mut self, op: &Value) -> Result<(), String> {
        let kind = op["type"].as_str().ok_or("Invalid operation")?;
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
        Ok(())
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
            if self.cursor == self.operations.len() {
                self.playing = false;
                return Ok(());
            }
            let op = self.operations[self.cursor].clone();
            let kind = op["type"].as_str().ok_or("Invalid operation")?;
            if kind == "narration.end" && self.narration_remaining_ms > 1e-8 {
                self.wait_ms = self.narration_remaining_ms;
                continue;
            }
            self.apply_operation(&op)?;
            self.cursor += 1;
            if self.cursor == self.operations.len() {
                self.playing = false;
                return Ok(());
            }
            if !self.board.animating() {
                self.wait_ms = operation_ms(&op);
            }
        }
    }
    pub fn waiting(&self) -> bool {
        !self.closed && self.cursor == self.operations.len()
    }
    fn events(&self) -> Result<Value, String> {
        Ok(Value::Array(
            self.source
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(serde_json::from_str)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?,
        ))
    }
    pub fn checkpoint(&self) -> Result<Value, String> {
        let events = self.events()?;
        Ok(
            json!({"profile":"octos.rust.playback.checkpoint","version":"0.1","program_fingerprint":crate::checkpoint::fingerprint(&events),"canonical_events":events,"cursor":self.cursor,"variables":self.board.variables,"animation":self.board.animation_state(),"wait_ms":self.wait_ms,"narration_remaining_ms":self.narration_remaining_ms}),
        )
    }
    pub fn restore(source: &str, saved: &Value) -> Result<Self, String> {
        let legacy = saved["profile"] == "octos.playback.checkpoint";
        if (!legacy && saved["profile"] != "octos.rust.playback.checkpoint")
            || saved["version"] != "0.1"
        {
            return Err("Unsupported checkpoint version".into());
        }
        let mut result = Self::load_incremental(source, true)?;
        let events = result.events()?;
        if saved["program_fingerprint"] != crate::checkpoint::fingerprint(&events) {
            return Err("Checkpoint belongs to a different course".into());
        }
        let cursor = saved["cursor"]
            .as_u64()
            .ok_or("Invalid checkpoint cursor")? as usize;
        if cursor > result.operations.len() {
            return Err("Checkpoint cursor out of range".into());
        }
        if legacy
            && (cursor == 0
                || saved["lesson_id"] != events[0]["lesson_id"]
                || saved["projection"]["cursor"] != saved["cursor"]
                || saved["projection"]["total_operations"].as_u64()
                    != Some(result.operations.len() as u64))
        {
            return Err("Inconsistent legacy checkpoint metadata".into());
        }
        while result.cursor < cursor {
            let op = result.operations[result.cursor].clone();
            result.apply_operation(&op)?;
            result.board.tick(1000.)?;
            result.cursor += 1;
        }
        let vars = if legacy {
            &saved["projection"]["board"]["variables"]
        } else {
            &saved["variables"]
        };
        for key in result.board.variables.clone().keys() {
            let v = if legacy {
                &vars[key]["value"]
            } else {
                &vars[key]
            };
            result
                .board
                .set_variable(key, v.as_f64().ok_or("Missing saved variable")?)?;
        }
        let animation = if legacy && !saved["variable_animation"].is_null() {
            let a = &saved["variable_animation"];
            let duration = match a["duration_intent"].as_str() {
                Some("brief") => 1.8,
                Some("normal") => 3.2,
                Some("extended") => 5.4,
                _ => return Err("Invalid animation duration".into()),
            };
            let progress = a["progress"].as_f64().ok_or("Invalid animation progress")?;
            json!({"variable":a["variable"],"from":a["from"],"to":a["to"],"duration":duration,"elapsed":progress*duration,"easing":a["easing"]})
        } else if legacy {
            Value::Null
        } else {
            saved["animation"].clone()
        };
        result.board.restore_animation(&animation)?;
        if !legacy {
            result.wait_ms = saved["wait_ms"].as_f64().ok_or("Invalid saved wait")?;
            result.narration_remaining_ms = saved["narration_remaining_ms"]
                .as_f64()
                .ok_or("Invalid saved narration")?;
            if !result.wait_ms.is_finite()
                || result.wait_ms < 0.
                || !result.narration_remaining_ms.is_finite()
                || result.narration_remaining_ms < 0.
            {
                return Err("Invalid checkpoint timing".into());
            }
        } else {
            result.wait_ms = 0.;
        }
        if legacy {
            let stored = &saved["projection"]["board"];
            for (key, objects) in [
                ("nodes", &result.board.nodes),
                ("connections", &result.board.connections),
                ("groups", &result.board.groups),
            ] {
                let map = objects
                    .iter()
                    .map(|v| (v["id"].as_str().unwrap().to_owned(), v.clone()))
                    .collect::<serde_json::Map<_, _>>();
                if !crate::checkpoint::equivalent(&Value::Object(map), &stored[key]) {
                    return Err(format!("Saved {key} differs from reconstructed course"));
                }
            }
            if json!(result.board.focus) != stored["focus"] {
                return Err("Saved focus differs from reconstructed course".into());
            }
        }
        result.playing = false;
        Ok(result)
    }
    /// Validate the entire candidate before publishing; duplicate events are idempotent.
    pub fn append(&mut self, incoming: &str) -> Result<usize, String> {
        let mut events = self.events()?.as_array().unwrap().clone();
        let mut added = 0;
        for line in incoming.lines().filter(|l| !l.trim().is_empty()) {
            let event: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
            let seq = event["sequence"].as_u64().ok_or("Missing event sequence")? as usize;
            if seq < events.len() {
                if events[seq] != event {
                    return Err("Conflicting duplicate event".into());
                }
                continue;
            }
            if seq != events.len() {
                return Err("Event sequence gap".into());
            }
            if events.last().is_some_and(|e| e["event"] == "lesson.close") {
                return Err("Cannot append after lesson.close".into());
            }
            events.push(event);
            added += 1;
        }
        if added == 0 {
            return Ok(0);
        }
        let source = events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let candidate = Self::load_incremental(&source, true)?;
        if candidate.operations.get(..self.operations.len()) != Some(self.operations.as_slice()) {
            return Err("Append changed prior operations".into());
        }
        let mut saved = self.checkpoint()?;
        saved["program_fingerprint"] = json!(crate::checkpoint::fingerprint(&Value::Array(events)));
        let mut next = Self::restore(&source, &saved)?;
        next.playing = self.playing;
        *self = next;
        Ok(added)
    }
}
