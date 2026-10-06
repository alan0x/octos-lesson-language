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
    incremental: bool,
    /// After-lesson student tasks and their progress.
    pub practice: crate::tasks::Practice,
    /// Recorded narration clip durations by Beat id (course pack manifest
    /// narration.segments): a Beat's narration lasts exactly its clip.
    pub narration_durations: std::collections::BTreeMap<String, f64>,
    /// Narration voice on. Off, the lesson does not wait for narration (web:
    /// a disabled voice completes each narration immediately).
    pub narration_enabled: bool,
    narration_beat: Option<String>,
    narration_total_ms: f64,
    /// Targets a seek asks the camera to show (web seekAttentionTargets).
    pub seek_attention: Vec<String>,
}

/// One Beat of the playback outline (web PlaybackOutlineBeat).
#[derive(Clone, Debug, PartialEq)]
pub struct OutlineBeat {
    pub id: String,
    pub title: String,
    pub start_cursor: usize,
    pub end_cursor: usize,
    pub focus_targets: Vec<String>,
}
/// One Step of the playback outline (web PlaybackOutlineStep).
#[derive(Clone, Debug, PartialEq)]
pub struct OutlineStep {
    pub id: String,
    pub title: String,
    pub start_cursor: usize,
    pub end_cursor: usize,
    pub focus_targets: Vec<String>,
    pub beats: Vec<OutlineBeat>,
}

/// Web narrationPreview: the first sentence, at most 42 characters.
fn narration_preview(text: Option<&str>, fallback: String) -> String {
    let normalized = text.map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
    if normalized.is_empty() {
        return fallback;
    }
    let sentence = normalized
        .char_indices()
        .find(|(_, c)| "。！？.!?".contains(*c))
        .map(|(i, c)| normalized[..i + c.len_utf8()].trim().to_owned());
    let preview = sentence.filter(|s| !s.is_empty()).unwrap_or(normalized);
    if preview.encode_utf16().count() > 42 {
        let cut: String = preview.chars().take(41).collect();
        format!("{}…", cut.trim_end())
    } else {
        preview
    }
}
/// Web focusTargets of an operation range (inclusive).
fn range_focus(ops: &[Value], start: usize, end: usize) -> Vec<String> {
    let scoped = &ops[start..=end.min(ops.len() - 1)];
    let ids = |a: &Value| -> Vec<String> {
        if a["op"] == "board.focus" {
            return a["focus"]["targets"].as_array().into_iter().flatten().filter_map(|t| t.as_str().map(str::to_owned)).collect();
        }
        let t = &a["target"];
        [a["node"]["id"].as_str(), a["connection"]["id"].as_str(), a["group"]["id"].as_str(), t["node_id"].as_str(), t["group_id"].as_str(), t["connection_id"].as_str()]
            .into_iter()
            .flatten()
            .map(str::to_owned)
            .collect()
    };
    let declared: Vec<String> = scoped
        .iter()
        .filter(|o| o["action"]["op"] == "board.focus")
        .flat_map(|o| ids(&o["action"]))
        .collect();
    let candidates = if declared.is_empty() {
        scoped.iter().flat_map(|o| ids(&o["action"])).collect()
    } else {
        declared
    };
    let mut out: Vec<String> = Vec::new();
    for c in candidates {
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
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
        let open: Value = source
            .lines()
            .find(|l| !l.trim().is_empty())
            .and_then(|l| serde_json::from_str(l).ok())
            .unwrap_or(Value::Null);
        Ok(Self {
            practice: crate::tasks::Practice::new(&open),
            narration_durations: Default::default(),
            narration_enabled: true,
            narration_beat: None,
            narration_total_ms: 0.,
            seek_attention: Vec::new(),
            board: Preview::load_incremental(source, allow_incomplete)?,
            source: source.into(),
            closed: last["event"] == "lesson.close",
            incremental: allow_incomplete,
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
    /// Web buildPlaybackOutline: steps (titled by purpose) and their Beats
    /// (titled by the narration's first sentence) with cursor ranges.
    pub fn outline(&self) -> Vec<OutlineStep> {
        let Ok(events) = self.events() else { return vec![] };
        let ops = &self.operations;
        let find = |kind: &str, key: &str, id: &str| ops.iter().position(|o| o["type"] == kind && o[key] == id);
        let mut steps = Vec::new();
        for event in events.as_array().into_iter().flatten() {
            if event["event"] != "lesson.step" {
                continue;
            }
            let step = &event["step"];
            let id = step["id"].as_str().unwrap_or("");
            let (Some(start), Some(end)) = (find("step.begin", "step_id", id), find("step.commit", "step_id", id)) else { continue };
            let beats = step["beats"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .filter_map(|(i, beat)| {
                    let bid = beat["id"].as_str()?;
                    let (bs, be) = (find("beat.begin", "beat_id", bid)?, find("beat.end", "beat_id", bid)?);
                    Some(OutlineBeat {
                        id: bid.to_owned(),
                        title: narration_preview(beat["narration"]["text"].as_str(), format!("讲解片段 {}", i + 1)),
                        start_cursor: bs,
                        end_cursor: be + 1,
                        focus_targets: range_focus(ops, bs, be),
                    })
                })
                .collect();
            steps.push(OutlineStep {
                id: id.to_owned(),
                title: step["purpose"].as_str().unwrap_or("").to_owned(),
                start_cursor: start,
                end_cursor: end + 1,
                focus_targets: range_focus(ops, start, end),
                beats,
            });
        }
        steps
    }
    /// The Step and Beat of the current operation (web currentStepId / currentBeatId).
    pub fn current_ids(&self) -> (Option<String>, Option<String>) {
        let op = self.cursor.checked_sub(1).and_then(|i| self.operations.get(i));
        (
            op.and_then(|o| o["step_id"].as_str().map(str::to_owned)),
            op.and_then(|o| o["beat_id"].as_str().map(str::to_owned)),
        )
    }
    /// Web seek: rebuild the lesson up to `cursor` (animations finished),
    /// paused, keeping task progress and the narration settings.
    pub fn seek(&mut self, cursor: usize, attention: Vec<String>) -> Result<(), String> {
        let cursor = cursor.min(self.operations.len());
        let mut fresh = Session::load_incremental(&self.source, self.incremental)?;
        fresh.narration_durations = std::mem::take(&mut self.narration_durations);
        fresh.narration_enabled = self.narration_enabled;
        fresh.practice = std::mem::take(&mut self.practice);
        fresh.practice.transition = None;
        while fresh.cursor < cursor {
            let op = fresh.operations[fresh.cursor].clone();
            fresh.apply_operation(&op)?;
            fresh.board.tick(1000.)?;
            fresh.cursor += 1;
        }
        fresh.playing = false;
        fresh.seek_attention = attention;
        *self = fresh;
        Ok(())
    }
    /// Web reset + play from the beginning.
    pub fn restart(&mut self) -> Result<(), String> {
        self.seek(0, vec![])?;
        self.play()
    }
    /// The Beat whose narration is being spoken and how far into it (ms).
    pub fn narration_position(&self) -> Option<(&str, f64)> {
        let beat = self.narration_beat.as_deref()?;
        Some((beat, (self.narration_total_ms - self.narration_remaining_ms).max(0.)))
    }
    /// Turn the narration voice on or off. Turning it off releases the
    /// narration in progress (the lesson moves on without waiting).
    pub fn set_narration_enabled(&mut self, enabled: bool) {
        self.narration_enabled = enabled;
        if !enabled {
            self.narration_remaining_ms = 0.;
        }
    }
    /// Web studentTasks snapshots (available once the lesson completed).
    pub fn tasks(&self) -> Vec<crate::tasks::Snapshot> {
        self.practice.snapshots(self.complete())
    }
    /// A practice start transition is moving variables; manual input is ignored.
    pub fn practice_transition(&self) -> bool {
        self.practice.transition.is_some()
    }
    /// Declared initial value of a lesson variable.
    pub fn initial(&self, alias: &str) -> Option<f64> {
        self.board
            .variable_declarations()
            .iter()
            .find(|d| d["as"] == alias)
            .and_then(|d| d["initial"].as_f64())
    }
    fn initials(&self) -> crate::expression::Variables {
        self.board
            .variable_declarations()
            .iter()
            .filter_map(|d| Some((d["as"].as_str()?.to_owned(), d["initial"].as_f64()?)))
            .collect()
    }
    /// Web activatePractice + phase transition timer: start the active task's
    /// start state once the lesson is complete and advance it. Returns true
    /// when variables changed.
    pub fn step_practice(&mut self, seconds: f64) -> Result<bool, String> {
        let initials = self.initials();
        let mut values = self
            .practice
            .activate(self.complete(), &self.board.variables, &initials);
        if values.is_none() {
            values = self.practice.tick(seconds);
        }
        let Some(values) = values else { return Ok(false) };
        for (alias, value) in values {
            self.board.set_variable(&alias, value)?;
        }
        Ok(true)
    }
    /// A learner variable change finished (web commitStudentVariableOperation):
    /// evaluate the active task against the current variables. `control` is
    /// slider, geometry_point or reset. Returns true when a task attempt was recorded.
    pub fn commit_student_variable(&mut self, alias: &str, control: &str) -> Result<bool, String> {
        if self.practice_transition() {
            return Ok(false);
        }
        let operation = crate::tasks::Operation::Variable {
            id: self.practice.next_operation_id(),
            alias: alias.to_owned(),
            control: control.to_owned(),
        };
        self.practice.evaluate(self.complete(), &operation, &self.board.variables)
    }
    /// A learner 3D view change finished (orbit, preset, zoom, reset).
    pub fn commit_student_view(&mut self, node: &str, control: &str, yaw: f64, pitch: f64, zoom: f64) -> Result<bool, String> {
        if self.practice_transition() {
            return Ok(false);
        }
        let operation = crate::tasks::Operation::Scene3dView {
            id: self.practice.next_operation_id(),
            node: node.to_owned(),
            control: control.to_owned(),
            yaw,
            pitch,
            zoom,
        };
        self.practice.evaluate(self.complete(), &operation, &self.board.variables)
    }
    pub fn task_hint(&mut self, task: &str) -> Result<(), String> {
        self.practice.hint(self.complete(), task)
    }
    /// Web retryStudentTask: variables return to their initial values (not
    /// evaluated), or the task's start state replays.
    pub fn task_retry(&mut self, task: &str) -> Result<(), String> {
        for alias in self.practice.retry(self.complete(), task)? {
            if let Some(initial) = self.initial(&alias) {
                self.board.set_variable(&alias, initial)?;
            }
        }
        Ok(())
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
                let beat = op["beat_id"].as_str().map(str::to_owned);
                self.narration_remaining_ms = if !self.narration_enabled {
                    0.
                } else if let Some(ms) = beat.as_ref().and_then(|b| self.narration_durations.get(b)) {
                    *ms
                } else {
                    narration_ms(&self.narration, op["narration"]["delivery"].as_str().unwrap_or(""))
                };
                self.narration_total_ms = self.narration_remaining_ms;
                self.narration_beat = beat;
            }
            "narration.end" | "beat.end" => {
                self.narration.clear();
                self.narration_remaining_ms = 0.0;
                self.narration_beat = None;
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
    /// Web advanceBeat: pause, then apply operations through the current
    /// Beat's `beat.end` (animations finish instantly), and stay paused.
    pub fn advance_beat(&mut self) -> Result<(), String> {
        self.playing = false;
        let finish = |board: &mut Preview| -> Result<(), String> {
            if board.animating() {
                let remaining = board.animation_remaining();
                board.tick(remaining)?;
            }
            Ok(())
        };
        finish(&mut self.board)?;
        while self.cursor < self.operations.len() {
            let op = self.operations[self.cursor].clone();
            self.apply_operation(&op)?;
            self.cursor += 1;
            finish(&mut self.board)?;
            if op["type"] == "beat.end" {
                break;
            }
        }
        self.wait_ms = 0.0;
        self.narration_remaining_ms = 0.0;
        Ok(())
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
    pub fn projection(&self) -> Result<Value, String> {
        let events = self.events()?;
        let open = &events[0];
        let mut projection = json!({"status":if self.complete(){"completed"}else if self.waiting(){"waiting"}else if self.playing{"playing"}else if self.cursor==0{"ready"}else{"paused"},"cursor":self.cursor,"total_operations":self.operations.len(),"lesson_id":open["lesson_id"],"board":null});
        if self.cursor == 0 {
            return Ok(projection);
        }
        let map = |objects: &Vec<Value>| {
            Value::Object(
                objects
                    .iter()
                    .map(|v| (v["id"].as_str().unwrap().to_owned(), v.clone()))
                    .collect(),
            )
        };
        let mut board = json!({"board_id":open["board"]["board_id"],"revision":open["board"]["base_revision"].as_u64().unwrap_or(0)+self.committed_steps.len() as u64,"nodes":map(&self.board.nodes),"connections":map(&self.board.connections),"groups":map(&self.board.groups),"focus":self.board.focus,"applied_lessons":[open["lesson_id"]],"applied_steps":self.committed_steps,"applied_actions":self.operations[..self.cursor].iter().filter(|o|o["type"]=="action.apply").map(|o|o["action"]["action_id"].clone()).collect::<Vec<_>>()});
        let mut variables = serde_json::Map::new();
        for d in open["lesson"]["variables"].as_array().into_iter().flatten() {
            let alias = d["as"].as_str().ok_or("Invalid variable alias")?;
            let mut v = json!({"value":self.board.variables[alias],"initial":d["initial"],"min":d["min"],"max":d["max"]});
            for k in ["label", "unit", "control"] {
                if let Some(value) = d.get(k) {
                    v[k] = value.clone();
                }
            }
            variables.insert(alias.into(), v);
        }
        if !variables.is_empty() {
            board["variables"] = Value::Object(variables);
        }
        projection["board"] = board;
        for op in &self.operations[..self.cursor] {
            match op["type"].as_str().unwrap_or("") {
                "step.begin" => projection["current_step_id"] = op["step_id"].clone(),
                "beat.begin" => projection["current_beat_id"] = op["beat_id"].clone(),
                "narration.begin" => projection["current_narration"] = op["narration"].clone(),
                "narration.end" => {
                    projection
                        .as_object_mut()
                        .unwrap()
                        .remove("current_narration");
                }
                "beat.end" => {
                    projection
                        .as_object_mut()
                        .unwrap()
                        .remove("current_beat_id");
                }
                "step.commit" => {
                    projection
                        .as_object_mut()
                        .unwrap()
                        .remove("current_step_id");
                }
                _ => (),
            }
        }
        if let Some(phase) = &self.current_phase {
            projection["current_phase"] = json!(phase);
        }
        Ok(projection)
    }
    pub fn checkpoint(&self) -> Result<Value, String> {
        let events = self.events()?;
        Ok(
            json!({"profile":"octos.rust.playback.checkpoint","version":"0.1","program_fingerprint":crate::checkpoint::fingerprint(&events),"canonical_events":events,"incremental":self.incremental,"cursor":self.cursor,"variables":self.board.variables,"animation":self.board.animation_state(),"wait_ms":self.wait_ms,"narration_remaining_ms":self.narration_remaining_ms,"practice":self.practice.log()}),
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
        let cursor = usize::try_from(
            saved["cursor"]
                .as_u64()
                .ok_or("Invalid checkpoint cursor")?,
        )
        .map_err(|_| "Checkpoint cursor overflow")?;
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
        result.incremental = if legacy {
            saved["canonical_events"].is_array()
        } else {
            saved["incremental"].as_bool().unwrap_or(true)
        };
        if saved["practice"].is_object() {
            result.practice.restore(&saved["practice"]);
        }
        result.playing = false;
        Ok(result)
    }
    /// Validate the entire candidate before publishing; duplicate events are idempotent.
    pub fn append(&mut self, incoming: &str) -> Result<usize, String> {
        if !self.incremental {
            return Err("Session was not opened for incremental playback".into());
        }
        let mut events = self.events()?.as_array().unwrap().clone();
        let mut added = 0;
        for line in incoming.lines().filter(|l| !l.trim().is_empty()) {
            let event: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
            let seq = usize::try_from(event["sequence"].as_u64().ok_or("Missing event sequence")?)
                .map_err(|_| "Event sequence overflow")?;
            if seq < events.len() {
                if crate::checkpoint::stringify(&events[seq])
                    != crate::checkpoint::stringify(&event)
                {
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
