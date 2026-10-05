//! After-lesson student tasks ("动手试一试"), ported from
//! packages/web-runtime/src/student-tasks.ts and the task parts of
//! runtime.ts (evaluateStudentTasks, requestStudentTaskHint,
//! retryStudentTask, activatePractice / practice start transitions).
//!
//! The progress log uses the Web `octos.student.task-progress-log` shape so
//! a saved log can be restored with the same validation rules.
use crate::expression::{evaluate, Variables};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Web variableAnimationDuration("brief") at normal speed, in seconds.
pub const PRACTICE_TRANSITION_SECONDS: f64 = 1.8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    NotStarted,
    InProgress,
    NeedsHint,
    Succeeded,
}
impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::NotStarted => "not_started",
            Status::InProgress => "in_progress",
            Status::NeedsHint => "needs_hint",
            Status::Succeeded => "succeeded",
        }
    }
    fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "not_started" => Status::NotStarted,
            "in_progress" => Status::InProgress,
            "needs_hint" => Status::NeedsHint,
            "succeeded" => Status::Succeeded,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Attempt {
    pub sequence: u64,
    pub operation_id: String,
    pub actual: f64,
    pub target: f64,
    pub succeeded: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub task_id: String,
    pub status: Status,
    pub hints_revealed: usize,
    pub attempts: Vec<Attempt>,
}

/// Web StudentTaskSnapshot.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub progress: Progress,
    pub available: bool,
    pub prompt: String,
    pub hints: Vec<String>,
    pub success_message: Option<String>,
    pub current_hint: Option<String>,
}

/// A committed student operation that tasks are evaluated against.
#[derive(Clone, Debug, PartialEq)]
pub enum Operation {
    /// A lesson variable changed through `control` (slider, geometry_point, reset…).
    Variable { id: String, alias: String, control: String },
    /// A 3D view changed through `control` (orbit, preset, zoom, reset…).
    Scene3dView { id: String, node: String, control: String, yaw: f64, pitch: f64, zoom: f64 },
}
impl Operation {
    fn id(&self) -> &str {
        match self {
            Operation::Variable { id, .. } | Operation::Scene3dView { id, .. } => id,
        }
    }
}

/// Animated move of variables to a task's start values (web phase transition).
#[derive(Clone, Debug, PartialEq)]
pub struct Transition {
    pub key: String,
    pub from: BTreeMap<String, f64>,
    pub to: BTreeMap<String, f64>,
    pub progress: f64,
}
impl Transition {
    /// Web applyPhaseProgress easing (easeInOutQuad).
    pub fn values(&self) -> BTreeMap<String, f64> {
        let t = self.progress.clamp(0., 1.);
        let eased = if t < 0.5 { 2. * t * t } else { 1. - (-2. * t + 2.).powi(2) / 2. };
        self.to
            .iter()
            .map(|(alias, to)| {
                let from = self.from.get(alias).copied().unwrap_or(*to);
                (alias.clone(), from + (to - from) * eased)
            })
            .collect()
    }
}

#[derive(Clone, Debug, Default)]
pub struct Practice {
    lesson_id: String,
    definitions: Vec<Value>,
    progress: Vec<Progress>,
    /// Retries of tasks with a start state (web practiceEpochs).
    epochs: BTreeMap<String, u32>,
    /// Practice start keys already applied (web phaseState.ready).
    ready: Vec<String>,
    pub transition: Option<Transition>,
    next_sequence: u64,
}

fn tolerance(def: &Value) -> f64 {
    let c = &def["completion"];
    if c["kind"] == "expression_target" {
        c["tolerance"].as_f64().unwrap_or(0.)
    } else {
        1.
    }
}
fn target(def: &Value) -> f64 {
    let c = &def["completion"];
    if c["kind"] == "expression_target" {
        c["value"].as_f64().unwrap_or(0.)
    } else {
        0.
    }
}

/// Web scene3dViewTargetScore: ≤ 1 means the view matches the target.
pub fn scene3d_view_score(yaw: f64, pitch: f64, zoom: f64, completion: &Value) -> f64 {
    let n = |k: &str| completion[k].as_f64().unwrap_or(0.);
    let angular = n("angular_tolerance").max(1e-12);
    if completion["match"] == "view_direction" {
        let dir = |yaw: f64, pitch: f64| (pitch.cos() * yaw.sin(), pitch.cos() * yaw.cos(), pitch.sin());
        let a = dir(yaw, pitch);
        let e = dir(n("yaw"), n("pitch"));
        let dot = (a.0 * e.0 + a.1 * e.1 + a.2 * e.2).clamp(-1., 1.);
        return dot.acos() / angular;
    }
    let yaw_distance = (yaw - n("yaw")).sin().atan2((yaw - n("yaw")).cos()).abs();
    let angular_distance = yaw_distance.max((pitch - n("pitch")).abs());
    (angular_distance / angular).max((zoom - n("zoom")).abs() / n("zoom_tolerance").max(1e-12))
}

impl Practice {
    /// Tasks of `lesson.open` (events[0]).
    pub fn new(open: &Value) -> Self {
        let definitions: Vec<Value> = open["lesson"]["tasks"].as_array().cloned().unwrap_or_default();
        Self {
            lesson_id: open["lesson_id"].as_str().unwrap_or("").to_owned(),
            progress: definitions
                .iter()
                .map(|d| Progress {
                    task_id: d["as"].as_str().unwrap_or("").to_owned(),
                    status: Status::NotStarted,
                    hints_revealed: 0,
                    attempts: vec![],
                })
                .collect(),
            definitions,
            ..Default::default()
        }
    }
    pub fn definitions(&self) -> &[Value] {
        &self.definitions
    }
    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty()
    }
    fn active(&self) -> Option<(&Value, &Progress)> {
        let p = self.progress.iter().find(|p| p.status != Status::Succeeded)?;
        let d = self.definitions.iter().find(|d| d["as"] == p.task_id.as_str())?;
        Some((d, p))
    }
    fn practice_key(&self, task: &str) -> String {
        format!("practice:{task}:{}", self.epochs.get(task).copied().unwrap_or(0))
    }
    /// Web studentTaskWindowOpen: the lesson is complete (`base`), no start
    /// transition is running, and the active task's start state is applied.
    pub fn window_open(&self, base: bool) -> bool {
        if self.transition.is_some() || !base {
            return false;
        }
        match self.active() {
            Some((d, _)) if d.get("start").is_some_and(|s| !s.is_null()) => {
                self.ready.contains(&self.practice_key(d["as"].as_str().unwrap_or("")))
            }
            _ => true,
        }
    }
    /// Web taskSnapshots: only the first unfinished task (and finished ones) are available.
    pub fn snapshots(&self, base: bool) -> Vec<Snapshot> {
        let open = self.window_open(base);
        let active = self.progress.iter().position(|p| p.status != Status::Succeeded);
        self.definitions
            .iter()
            .enumerate()
            .map(|(index, d)| {
                let progress = self.progress[index].clone();
                let hints: Vec<String> = d["hints"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|h| h.as_str().map(str::to_owned))
                    .collect();
                let current_hint = (progress.hints_revealed > 0)
                    .then(|| hints.get(progress.hints_revealed.min(hints.len()).saturating_sub(1)).cloned())
                    .flatten();
                Snapshot {
                    available: open
                        && d["availability"]["kind"] == "after_lesson"
                        && (progress.status == Status::Succeeded || Some(index) == active),
                    prompt: d["prompt"].as_str().unwrap_or("").to_owned(),
                    success_message: d["success_message"].as_str().map(str::to_owned),
                    current_hint,
                    hints,
                    progress,
                }
            })
            .collect()
    }
    /// The active, unfinished variable task that accepts `control` on `alias`
    /// (web snapValueToActiveTask's task lookup).
    pub fn active_variable_task(&self, base: bool, alias: &str, control: &str) -> Option<&Value> {
        if !self.window_open(base) {
            return None;
        }
        let (d, _) = self.active()?;
        (d["completion"]["kind"] == "expression_target"
            && d["allowed_operations"].as_array()?.iter().any(|o| {
                o["kind"] == "variable_change"
                    && o["variable"] == alias
                    && o["controls"].as_array().is_some_and(|c| c.iter().any(|c| c == control))
            }))
        .then_some(d)
    }
    pub fn next_operation_id(&mut self) -> String {
        self.next_sequence += 1;
        format!("{}:student-operation:{}", self.lesson_id, self.next_sequence)
    }
    /// Web evaluateStudentTasks + evaluateStudentTaskOperation. Returns true
    /// when an attempt was recorded.
    pub fn evaluate(&mut self, base: bool, operation: &Operation, variables: &Variables) -> Result<bool, String> {
        if !self.window_open(base) {
            return Ok(false);
        }
        let Some(index) = self.progress.iter().position(|p| p.status != Status::Succeeded) else {
            return Ok(false);
        };
        let Some(def) = self.definitions.iter().find(|d| d["as"] == self.progress[index].task_id.as_str()).cloned() else {
            return Ok(false);
        };
        let progress = &mut self.progress[index];
        if progress.attempts.iter().any(|a| a.operation_id == operation.id()) {
            return Ok(false);
        }
        let allowed = |kind: &str, key: &str, value: &str, control: &str| {
            def["allowed_operations"].as_array().is_some_and(|ops| {
                ops.iter().any(|o| {
                    o["kind"] == kind
                        && o[key] == value
                        && o["controls"].as_array().is_some_and(|c| c.iter().any(|c| c == control))
                })
            })
        };
        let completion = &def["completion"];
        let (actual, target, succeeded) = if completion["kind"] == "expression_target" {
            let Operation::Variable { alias, control, .. } = operation else { return Ok(false) };
            if !allowed("variable_change", "variable", alias, control) {
                return Ok(false);
            }
            let actual = evaluate(completion["expression"].as_str().unwrap_or(""), variables)?;
            let target = target(&def);
            (actual, target, (actual - target).abs() <= tolerance(&def))
        } else {
            let Operation::Scene3dView { node, control, yaw, pitch, zoom, .. } = operation else { return Ok(false) };
            if !allowed("scene3d_view", "node", node, control) {
                return Ok(false);
            }
            let actual = scene3d_view_score(*yaw, *pitch, *zoom, completion);
            (actual, 0., actual <= 1.)
        };
        progress.attempts.push(Attempt {
            sequence: progress.attempts.len() as u64 + 1,
            operation_id: operation.id().to_owned(),
            actual,
            target,
            succeeded,
        });
        let threshold = def["hint_after_attempts"].as_u64().unwrap_or(2) as usize;
        progress.status = if succeeded {
            Status::Succeeded
        } else if progress.attempts.len() >= threshold {
            Status::NeedsHint
        } else {
            Status::InProgress
        };
        Ok(true)
    }
    fn check_available(&self, base: bool, task: &str) -> Result<usize, String> {
        let index = self
            .progress
            .iter()
            .position(|p| p.task_id == task)
            .ok_or_else(|| format!("Unknown student task '{task}'"))?;
        if !self.window_open(base) {
            return Err(format!("Student task '{task}' is not available before the lesson completes"));
        }
        if !self.snapshots(base)[index].available {
            return Err(format!("Student task '{task}' is not currently available"));
        }
        Ok(index)
    }
    /// Web requestStudentTaskHint.
    pub fn hint(&mut self, base: bool, task: &str) -> Result<(), String> {
        let index = self.check_available(base, task)?;
        let hints = self.definitions[index]["hints"].as_array().map_or(0, Vec::len);
        let p = &mut self.progress[index];
        if p.status != Status::Succeeded {
            p.hints_revealed = hints.min(p.hints_revealed + 1);
            p.status = Status::NeedsHint;
        }
        Ok(())
    }
    /// Web retryStudentTask. Tasks with a start state replay their start
    /// transition (returns no resets); other tasks return the variables to
    /// reset to their initial values (applied by the host as `reset`
    /// operations that are not evaluated).
    pub fn retry(&mut self, base: bool, task: &str) -> Result<Vec<String>, String> {
        let index = self.check_available(base, task)?;
        let def = self.definitions[index].clone();
        self.progress[index].status = Status::NotStarted;
        if def.get("start").is_some_and(|s| !s.is_null()) {
            *self.epochs.entry(task.to_owned()).or_default() += 1;
            return Ok(vec![]);
        }
        let mut aliases: Vec<String> = Vec::new();
        for o in def["allowed_operations"].as_array().into_iter().flatten() {
            if o["kind"] == "variable_change" {
                if let Some(a) = o["variable"].as_str() {
                    if !aliases.iter().any(|x| x == a) {
                        aliases.push(a.to_owned());
                    }
                }
            }
        }
        Ok(aliases)
    }
    /// Web activatePractice: when the lesson is complete and the active task
    /// has a start state not yet applied, begin a transition to it. Returns
    /// values to apply immediately when nothing needs animating.
    pub fn activate(&mut self, base: bool, variables: &Variables, initials: &Variables) -> Option<BTreeMap<String, f64>> {
        if !base || self.transition.is_some() {
            return None;
        }
        let (def, _) = self.active()?;
        let start = def.get("start").filter(|s| !s.is_null())?.clone();
        let key = self.practice_key(def["as"].as_str().unwrap_or(""));
        if self.ready.contains(&key) {
            return None;
        }
        let to: BTreeMap<String, f64> = start["variables"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|alias| {
                let value = start["values"][alias].as_f64().or_else(|| initials.get(alias).copied())?;
                Some((alias.to_owned(), value))
            })
            .collect();
        let from: BTreeMap<String, f64> = to
            .keys()
            .map(|a| (a.clone(), variables.get(a).copied().unwrap_or(to[a])))
            .collect();
        if to.iter().all(|(a, v)| from.get(a) == Some(v)) {
            self.ready.push(key);
            return Some(to);
        }
        self.transition = Some(Transition { key, from, to, progress: 0. });
        None
    }
    /// Advance a running start transition. Returns the variable values to
    /// apply this frame.
    pub fn tick(&mut self, seconds: f64) -> Option<BTreeMap<String, f64>> {
        let t = self.transition.as_mut()?;
        t.progress = (t.progress + seconds / PRACTICE_TRANSITION_SECONDS).min(1.);
        let values = t.values();
        if t.progress >= 1. {
            let key = t.key.clone();
            self.ready.push(key);
            self.transition = None;
        }
        Some(values)
    }
    /// Snap a slider/geometry value to the task target when within
    /// `snap_distance` (web snapValueToActiveTask).
    pub fn snap(
        &self,
        base: bool,
        alias: &str,
        control: &str,
        value: f64,
        snap_distance: f64,
        variables: &Variables,
        (min, max, step): (f64, f64, Option<f64>),
    ) -> f64 {
        if !snap_distance.is_finite() || snap_distance <= 0. {
            return value;
        }
        let Some(task) = self.active_variable_task(base, alias, control) else { return value };
        let range = max - min;
        let step = step.unwrap_or(range / 100.);
        if !step.is_finite() || step <= 0. || range <= 0. {
            return value;
        }
        let expression = task["completion"]["expression"].as_str().unwrap_or("");
        let (goal, tol) = (target(task), tolerance(task));
        let succeeds = |candidate: f64| {
            let mut values = variables.clone();
            values.insert(alias.to_owned(), candidate);
            evaluate(expression, &values).is_ok_and(|a| a.is_finite() && (a - goal).abs() <= tol)
        };
        if succeeds(value) {
            return value;
        }
        const MAX_SAMPLES: i64 = 20_000;
        let first = 0f64.max(((value - snap_distance - min) / step).floor()) as i64;
        let last = ((range / step + 1e-12).floor()).min(((value + snap_distance - min) / step).ceil()) as i64;
        if last < first {
            return value;
        }
        let mut steps: Vec<i64> = if last - first + 1 <= MAX_SAMPLES {
            (first..=last).collect()
        } else {
            let mut s: Vec<i64> = (0..MAX_SAMPLES)
                .map(|i| (first as f64 + (last - first) as f64 * i as f64 / (MAX_SAMPLES - 1) as f64).round() as i64)
                .collect();
            s.push(((value - min) / step).round() as i64);
            s
        };
        steps.dedup();
        let (mut snapped, mut nearest) = (value, f64::INFINITY);
        let mut seen = std::collections::BTreeSet::new();
        for index in steps {
            if !seen.insert(index) {
                continue;
            }
            let candidate: f64 = format!("{:.14e}", min + index as f64 * step).parse().unwrap_or(0.);
            let distance = (candidate - value).abs();
            if candidate < min || candidate > max || distance > snap_distance || distance >= nearest || !succeeds(candidate) {
                continue;
            }
            snapped = candidate;
            nearest = distance;
        }
        snapped
    }
    /// The web progress log (octos.student.task-progress-log 0.1).
    pub fn log(&self) -> Value {
        json!({
            "profile": "octos.student.task-progress-log",
            "version": "0.1",
            "lesson_id": self.lesson_id,
            "tasks": self.progress.iter().map(|p| json!({
                "task_id": p.task_id,
                "status": p.status.as_str(),
                "hints_revealed": p.hints_revealed,
                "attempts": p.attempts.iter().map(|a| json!({
                    "sequence": a.sequence, "operation_id": a.operation_id,
                    "actual": a.actual, "target": a.target, "succeeded": a.succeeded,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "ready": self.ready,
            "epochs": self.epochs,
            "next_sequence": self.next_sequence,
        })
    }
    /// Web parseStudentTaskProgressLog; an invalid log is ignored (fresh progress).
    pub fn restore(&mut self, saved: &Value) -> bool {
        let Some(progress) = parse_log(saved, &self.lesson_id, &self.definitions) else {
            return false;
        };
        self.progress = progress;
        self.ready = saved["ready"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        self.epochs = saved["epochs"]
            .as_object()
            .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_u64()? as u32))).collect())
            .unwrap_or_default();
        self.next_sequence = saved["next_sequence"].as_u64().unwrap_or(0);
        true
    }
}

fn parse_log(v: &Value, lesson_id: &str, definitions: &[Value]) -> Option<Vec<Progress>> {
    if v["profile"] != "octos.student.task-progress-log" || v["version"] != "0.1" || v["lesson_id"] != lesson_id {
        return None;
    }
    let mut by_id: BTreeMap<String, Progress> = BTreeMap::new();
    for raw in v["tasks"].as_array()? {
        let id = raw["task_id"].as_str()?;
        let def = definitions.iter().find(|d| d["as"] == id)?;
        if by_id.contains_key(id) {
            return None;
        }
        let status = Status::parse(raw["status"].as_str()?)?;
        let hints_revealed = raw["hints_revealed"].as_u64()? as usize;
        let mut attempts = Vec::new();
        let mut last = 0;
        for a in raw["attempts"].as_array()? {
            let attempt = Attempt {
                sequence: a["sequence"].as_u64()?,
                operation_id: a["operation_id"].as_str().filter(|s| !s.is_empty())?.to_owned(),
                actual: a["actual"].as_f64().filter(|x| x.is_finite())?,
                target: a["target"].as_f64().filter(|x| x.is_finite())?,
                succeeded: a["succeeded"].as_bool()?,
            };
            if attempt.sequence <= last
                || attempts.iter().any(|x: &Attempt| x.operation_id == attempt.operation_id)
                || attempt.target != target(def)
                || attempt.succeeded != ((attempt.actual - attempt.target).abs() <= tolerance(def))
            {
                return None;
            }
            last = attempt.sequence;
            attempts.push(attempt);
        }
        if (status == Status::Succeeded) != attempts.iter().any(|a| a.succeeded) {
            return None;
        }
        let hints = def["hints"].as_array().map_or(0, Vec::len);
        by_id.insert(
            id.to_owned(),
            Progress { task_id: id.to_owned(), status, hints_revealed: hints_revealed.min(hints), attempts },
        );
    }
    if by_id.len() != definitions.len() {
        return None;
    }
    definitions.iter().map(|d| by_id.remove(d["as"].as_str()?)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn lesson() -> Value {
        json!({"lesson_id": "L", "lesson": {"tasks": [
            {"as": "t1", "prompt": "把 k 调到 2", "hints": ["h1", "h2"], "availability": {"kind": "after_lesson"},
             "allowed_operations": [{"kind": "variable_change", "variable": "k", "controls": ["slider"]}],
             "completion": {"kind": "expression_target", "expression": "k", "value": 2, "tolerance": 0.01},
             "success_message": "好"},
            {"as": "t2", "prompt": "再调到 0", "hints": ["x"], "availability": {"kind": "after_lesson"},
             "start": {"variables": ["k"], "values": {"k": 1}},
             "allowed_operations": [{"kind": "variable_change", "variable": "k", "controls": ["slider"]}],
             "completion": {"kind": "expression_target", "expression": "k", "value": 0, "tolerance": 0.01}}
        ]}})
    }
    fn vars(k: f64) -> Variables {
        [("k".to_owned(), k)].into_iter().collect()
    }
    fn op(p: &mut Practice) -> Operation {
        Operation::Variable { id: p.next_operation_id(), alias: "k".into(), control: "slider".into() }
    }
    #[test]
    fn attempts_hints_success_and_start_transition_follow_the_web_rules() {
        let mut p = Practice::new(&lesson());
        assert!(!p.snapshots(false)[0].available);
        assert!(p.snapshots(true)[0].available && !p.snapshots(true)[1].available);
        let o = op(&mut p);
        assert!(p.evaluate(true, &o, &vars(1.)).unwrap());
        assert_eq!(p.snapshots(true)[0].progress.status, Status::InProgress);
        assert!(!p.evaluate(true, &o, &vars(1.)).unwrap(), "same operation counts once");
        let o = op(&mut p);
        p.evaluate(true, &o, &vars(1.5)).unwrap();
        assert_eq!(p.snapshots(true)[0].progress.status, Status::NeedsHint);
        p.hint(true, "t1").unwrap();
        assert_eq!(p.snapshots(true)[0].current_hint.as_deref(), Some("h1"));
        // Snapping: 1.995 is within tolerance already; 1.97 snaps to 2.
        assert_eq!(p.snap(true, "k", "slider", 1.97, 0.04, &vars(1.97), (-5., 5., Some(0.01))), 2.);
        let o = op(&mut p);
        p.evaluate(true, &o, &vars(2.)).unwrap();
        assert_eq!(p.snapshots(true)[0].progress.status, Status::Succeeded);
        // Task 2 has a start state: the window closes until it is applied.
        assert!(!p.window_open(true));
        assert!(p.activate(true, &vars(2.), &vars(0.)).is_none());
        let mut last = BTreeMap::new();
        while let Some(v) = p.tick(0.5) {
            last = v;
        }
        assert_eq!(last["k"], 1.);
        assert!(p.window_open(true) && p.snapshots(true)[1].available);
        // Save/restore round trip.
        let mut q = Practice::new(&lesson());
        assert!(q.restore(&p.log()));
        assert_eq!(q.snapshots(true), p.snapshots(true));
    }
}
