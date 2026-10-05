//! Restricted canonical playback slice for native renderer validation.
//! The host owns pacing. This is not the production narration scheduler.
use crate::expression::{evaluate, Variables};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug)]
pub struct Frame {
    pub narration: String,
    pub action: Value,
    pub step_id: String,
    pub beat_id: String,
    /// Beat phase (before_speech, during_speech, after_speech).
    pub phase: String,
}
#[derive(Clone, Debug)]
pub struct Preview {
    pub title: String,
    pub summary: String,
    pub variables: Variables,
    pub nodes: Vec<Value>,
    pub connections: Vec<Value>,
    pub groups: Vec<Value>,
    /// Presentation cue only; teacher.point does not mutate semantic board state.
    pub last_point: Option<Value>,
    /// Presentation cue only; teacher.expression does not mutate semantic board state.
    pub last_expression: Option<String>,
    pub focus: Vec<String>,
    pub narration: String,
    pub cursor: usize,
    frames: Vec<Frame>,
    declarations: Vec<Value>,
    /// lesson.reflections: thinking questions shown after the lesson.
    reflections: Vec<Value>,
    animation: Option<Animation>,
}
#[derive(Clone, Debug)]
struct Animation {
    variable: String,
    from: f64,
    to: f64,
    duration: f64,
    elapsed: f64,
    easing: String,
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .ok_or_else(|| format!("Missing string {key}"))
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v[key]
        .as_array()
        .ok_or_else(|| format!("Missing array {key}"))
}
impl Preview {
    pub fn load(source: &str) -> Result<Self, String> {
        Self::load_incremental(source, false)
    }
    /// A board-only snapshot (no playable frames) for layout replays, e.g.
    /// Web reference fixtures that record nodes, groups and connections.
    pub fn from_board(nodes: Vec<Value>, groups: Vec<Value>, connections: Vec<Value>) -> Self {
        Self {
            title: String::new(),
            summary: String::new(),
            variables: Variables::new(),
            nodes,
            connections,
            groups,
            last_point: None,
            last_expression: None,
            focus: Vec::new(),
            narration: String::new(),
            cursor: 0,
            frames: Vec::new(),
            declarations: Vec::new(),
            reflections: Vec::new(),
            animation: None,
        }
    }
    pub fn load_incremental(source: &str, allow_incomplete: bool) -> Result<Self, String> {
        let events: Vec<Value> = source
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        if events.is_empty()
            || events[0]["event"] != "lesson.open"
            || (!allow_incomplete && events.last().unwrap()["event"] != "lesson.close")
        {
            return Err("Expected a complete canonical lesson".into());
        }
        let id = string(&events[0], "lesson_id")?;
        for (i, e) in events.iter().enumerate() {
            if e["dsl"] != "octos.lesson"
                || e["profile"] != "canonical"
                || e["version"] != "0.1"
                || e["lesson_id"] != id
                || e["sequence"].as_u64() != Some(i as u64)
            {
                return Err(format!("Invalid envelope at event {i}"));
            }
        }
        let declarations = events[0]["lesson"]["variables"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut variables = Variables::new();
        for d in &declarations {
            let name = string(d, "as")?;
            let initial = d["initial"].as_f64().ok_or("Missing initial value")?;
            if variables.insert(name.into(), initial).is_some() {
                return Err("Duplicate variable".into());
            }
        }
        let mut frames = Vec::new();
        let mut ids = BTreeSet::new();
        let end = events.len() - usize::from(events.last().unwrap()["event"] == "lesson.close");
        for event in &events[1..end] {
            if event["event"] != "lesson.step" {
                return Err("Expected lesson.step".into());
            }
            for beat in array(&event["step"], "beats")? {
                for phase in ["before_speech", "during_speech", "after_speech"] {
                    for action in array(&beat["stage"], phase)? {
                        let op = string(action, "op")?;
                        if !matches!(
                            op,
                            "board.create"
                                | "board.connect"
                                | "board.focus"
                                | "board.group"
                                | "board.emphasize"
                                | "board.revise"
                                | "teacher.point"
                                | "teacher.expression"
                                | "lesson.variable.animate"
                        ) {
                            return Err(format!("Preview does not yet support {op}"));
                        }
                        if !ids.insert(string(action, "action_id")?.to_owned()) {
                            return Err("Duplicate action id".into());
                        }
                        if op == "board.create"
                            && !matches!(
                                action["node"]["kind"].as_str(),
                                Some(
                                    "geometry"
                                        | "plot"
                                        | "math"
                                        | "note"
                                        | "text"
                                        | "diagram"
                                        | "scene3d"
                                )
                            )
                        {
                            return Err("Unsupported preview node kind".into());
                        }
                        if op == "board.create"
                            && action["node"]["kind"] == "diagram"
                            && !action["node"]["content"]["sequence"].is_array()
                        {
                            return Err(
                                "Native preview currently supports sequence diagrams only".into()
                            );
                        }
                        frames.push(Frame {
                            narration: if phase == "during_speech" {
                                beat["narration"]["text"].as_str().unwrap_or("").into()
                            } else {
                                String::new()
                            },
                            action: action.clone(),
                            step_id: string(&event["step"], "id")?.into(),
                            beat_id: string(beat, "id")?.into(),
                            phase: phase.to_string(),
                        });
                    }
                }
            }
        }
        let result = Self {
            title: string(&events[0]["lesson"], "title")?.into(),
            summary: events.last().unwrap()["result"]["summary"]
                .as_str()
                .unwrap_or("")
                .into(),
            variables,
            nodes: Vec::new(),
            connections: Vec::new(),
            groups: Vec::new(),
            last_point: None,
            last_expression: None,
            focus: Vec::new(),
            narration: String::new(),
            cursor: 0,
            frames,
            declarations,
            reflections: events[0]["lesson"]["reflections"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
            animation: None,
        };
        // Validate all supported actions before the host opens the lesson.
        let mut validation = result.clone();
        for (name, value) in result.variables.clone() {
            validation.set_variable(&name, value)?;
        }
        while validation.cursor < validation.frames.len() {
            validation.advance()?;
            validation.tick(1000.0)?;
        }
        Ok(result)
    }
    pub fn animation_state(&self) -> Option<Value> {
        self.animation.as_ref().map(|a| serde_json::json!({"variable":a.variable,"from":a.from,"to":a.to,"duration":a.duration,"elapsed":a.elapsed,"easing":a.easing}))
    }
    pub fn restore_animation(&mut self, state: &Value) -> Result<(), String> {
        if state.is_null() {
            self.animation = None;
            return Ok(());
        }
        let variable = string(state, "variable")?;
        let from = state["from"].as_f64().ok_or("Invalid animation start")?;
        let to = state["to"].as_f64().ok_or("Invalid animation end")?;
        let duration = state["duration"]
            .as_f64()
            .ok_or("Invalid animation duration")?;
        let elapsed = state["elapsed"].as_f64().ok_or("Invalid animation time")?;
        let easing = string(state, "easing")?;
        if ![1.8, 3.2, 5.4].contains(&duration)
            || !elapsed.is_finite()
            || elapsed < 0.
            || elapsed >= duration
            || !matches!(easing, "linear" | "ease_in_out")
        {
            return Err("Invalid animation state".into());
        }
        self.check_value(variable, from)?;
        self.check_value(variable, to)?;
        let action = &self
            .frames
            .get(
                self.cursor
                    .checked_sub(1)
                    .ok_or("Animation before action")?,
            )
            .ok_or("Invalid animation cursor")?
            .action;
        if action["op"] != "lesson.variable.animate"
            || action["animation"]["variable"] != variable
            || action["animation"]["to"].as_f64() != Some(to)
            || action["animation"]["easing"] != easing
        {
            return Err("Animation differs from course action".into());
        }
        let expected = match action["animation"]["duration_intent"].as_str() {
            Some("brief") => 1.8,
            Some("normal") => 3.2,
            Some("extended") => 5.4,
            _ => return Err("Invalid animation intent".into()),
        };
        if duration != expected {
            return Err("Animation duration differs from course".into());
        }
        self.animation = Some(Animation {
            variable: variable.into(),
            from,
            to,
            duration,
            elapsed,
            easing: easing.into(),
        });
        self.tick(0.)
    }
    pub fn action_count(&self) -> usize {
        self.frames.len()
    }
    /// The canonical action of frame `index` (applied or not).
    pub fn frame_action(&self, index: usize) -> Option<&Value> {
        self.frames.get(index).map(|f| &f.action)
    }
    /// The Beat of the most recently applied action (web current_beat_id).
    pub fn current_beat(&self) -> Option<&str> {
        self.cursor
            .checked_sub(1)
            .and_then(|i| self.frames.get(i))
            .map(|f| f.beat_id.as_str())
    }
    /// Web player-core outline focus_targets of a Beat: its board.focus
    /// targets, otherwise every action target, first occurrence order.
    pub fn beat_focus_targets(&self, beat: &str) -> Vec<String> {
        let actions: Vec<&Value> = self
            .frames
            .iter()
            .filter(|f| f.beat_id == beat)
            .map(|f| &f.action)
            .collect();
        let focus: Vec<&str> = actions
            .iter()
            .filter(|a| a["op"] == "board.focus")
            .flat_map(|a| a["focus"]["targets"].as_array().into_iter().flatten())
            .filter_map(Value::as_str)
            .collect();
        let candidates: Vec<&str> = if !focus.is_empty() {
            focus
        } else {
            actions
                .iter()
                .flat_map(|a| {
                    let t = &a["target"];
                    [
                        a["node"]["id"].as_str(),
                        a["connection"]["id"].as_str(),
                        a["group"]["id"].as_str(),
                        t["node_id"].as_str(),
                        t["group_id"].as_str(),
                        t["connection_id"].as_str(),
                    ]
                })
                .flatten()
                .collect()
        };
        let mut out: Vec<String> = Vec::new();
        for id in candidates {
            if !out.iter().any(|o| o == id) {
                out.push(id.into());
            }
        }
        out
    }
    /// Host teaching-layout inputs (octos-learn oll-artifacts): node -> step
    /// in creation order, and per-step planned card counts in step order.
    /// Cards the Beat creates up to the current operation (web
    /// compositionTargets' `created`). The Web slices the operation stream
    /// through `cursor` inclusive, so the next action already counts when it
    /// directly follows in the same phase (no phase.end/begin between them).
    pub fn beat_created(&self, beat: &str) -> Vec<String> {
        let mut end = self.cursor.min(self.frames.len());
        if let (Some(last), Some(next)) = (
            self.cursor.checked_sub(1).and_then(|i| self.frames.get(i)),
            self.frames.get(self.cursor),
        ) {
            if next.beat_id == last.beat_id && next.phase == last.phase {
                end += 1;
            }
        }
        self.frames[..end]
            .iter()
            .filter(|f| f.beat_id == beat && f.action["op"] == "board.create")
            .filter_map(|f| f.action["node"]["id"].as_str().map(str::to_owned))
            .collect()
    }
    /// Web stepContextTargets: cards the Beat's Step wrote before the Beat.
    pub fn step_context_targets(&self, beat: &str) -> Vec<String> {
        let Some(start) = self.frames.iter().position(|f| f.beat_id == beat) else {
            return vec![];
        };
        let step = &self.frames[start].step_id;
        let mut out: Vec<String> = Vec::new();
        for f in &self.frames[..start] {
            if &f.step_id != step || f.action["op"] != "board.create" {
                continue;
            }
            if let Some(id) = f.action["node"]["id"].as_str() {
                if !out.iter().any(|o| o == id) {
                    out.push(id.to_owned());
                }
            }
        }
        out
    }
    pub fn node_sections(&self) -> Vec<(String, String)> {
        self.frames
            .iter()
            .filter(|f| f.action["op"] == "board.create")
            .filter_map(|f| f.action["node"]["id"].as_str().map(|id| (id.to_owned(), f.step_id.clone())))
            .collect()
    }
    pub fn planned_steps(&self) -> Vec<(String, crate::teaching::Planned)> {
        let mut out: Vec<(String, crate::teaching::Planned)> = Vec::new();
        for f in &self.frames {
            if !out.iter().any(|(s, _)| s == &f.step_id) {
                out.push((f.step_id.clone(), Default::default()));
            }
            if f.action["op"] != "board.create" {
                continue;
            }
            let counts = &mut out.iter_mut().find(|(s, _)| s == &f.step_id).unwrap().1;
            match f.action["node"]["kind"].as_str().unwrap_or("") {
                k if crate::teaching::is_visual(k) => counts.visual += 1,
                "math" => counts.math += 1,
                _ => counts.text += 1,
            }
        }
        out
    }
    pub fn animation_remaining(&self) -> f64 {
        self.animation
            .as_ref()
            .map(|a| (a.duration - a.elapsed).max(0.0))
            .unwrap_or(0.0)
    }
    pub fn animating(&self) -> bool {
        self.animation.is_some()
    }
    pub fn complete(&self) -> bool {
        self.cursor == self.frames.len() && !self.animating()
    }
    pub fn advance(&mut self) -> Result<(), String> {
        if self.animating() {
            return Err("Animation must finish before advancing".into());
        }
        if self.cursor == self.frames.len() {
            return Ok(());
        }
        let frame = self.frames[self.cursor].clone();
        let a = &frame.action;
        match string(a, "op")? {
            "board.create" => {
                let node = &a["node"];
                let id = string(node, "id")?;
                if self.nodes.iter().any(|n| n["id"] == id) {
                    return Err("Duplicate node".into());
                }
                if let Some(anchor) = node["placement"]["anchor"].as_str() {
                    self.require_anchor(anchor)?;
                }
                let mut node = node.clone();
                bind(&mut node["content"], &self.variables)?;
                if node["kind"] == "scene3d" {
                    crate::scene3d::validate(&node["content"], &self.variables)?;
                }
                self.nodes.push(node);
            }
            "board.connect" => {
                let c = &a["connection"];
                if self.connections.iter().any(|v| v["id"] == c["id"]) {
                    return Err("Duplicate connection".into());
                }
                for end in ["from", "to"] {
                    self.require_target(&c[end])?;
                }
                self.connections.push(c.clone());
            }
            "board.focus" => {
                let targets = array(&a["focus"], "targets")?;
                for target in targets {
                    self.require_focus(target.as_str().ok_or("Invalid focus")?)?;
                }
                self.focus = targets
                    .iter()
                    .map(|v| v.as_str().unwrap().to_owned())
                    .collect();
            }
            "board.group" => {
                let group = &a["group"];
                let id = string(group, "id")?;
                if self.groups.iter().any(|v| v["id"] == id) {
                    return Err("Duplicate group".into());
                }
                for member in array(group, "members")? {
                    self.require_anchor(member.as_str().ok_or("Invalid group member")?)?;
                }
                self.groups.push(group.clone());
            }
            "board.emphasize" => {
                let target = &a["target"];
                self.require_target(target)?;
                let emphasis = string(a, "emphasis")?;
                let (key, objects) = if target["node_id"].is_string() {
                    ("node_id", &mut self.nodes)
                } else if target["connection_id"].is_string() {
                    ("connection_id", &mut self.connections)
                } else {
                    ("group_id", &mut self.groups)
                };
                let object = objects.iter_mut().find(|v| v["id"] == target[key]).unwrap();
                if object.get("emphasis").is_none() {
                    object["emphasis"] = serde_json::json!([]);
                }
                object["emphasis"]
                    .as_array_mut()
                    .ok_or("Invalid emphasis list")?
                    .push(serde_json::json!({"target": target, "emphasis": emphasis}));
            }
            "teacher.point" => {
                self.require_target(&a["target"])?;
                self.last_point = Some(a["target"].clone());
            }
            "teacher.expression" => {
                let expression = string(&a, "expression")?;
                if expression.is_empty() {
                    return Err("teacher.expression requires expression".into());
                }
                self.last_expression = Some(expression.into());
            }
            "board.revise" => {
                let id = string(&a["target"], "node_id")?;
                self.require_node(id)?;
                let mut content = a["revision"]
                    .get("content")
                    .ok_or("Missing revision content")?
                    .clone();
                bind(&mut content, &self.variables)?;
                let node = self.nodes.iter_mut().find(|v| v["id"] == id).unwrap();
                if node["kind"] == "scene3d" {
                    crate::scene3d::validate(&content, &self.variables)?;
                }
                node["content"] = content;
            }
            "lesson.variable.animate" => {
                let d = &a["animation"];
                let variable = string(d, "variable")?.to_owned();
                let from = *self
                    .variables
                    .get(&variable)
                    .ok_or("Unknown animation variable")?;
                let to = d["to"].as_f64().ok_or("Invalid animation target")?;
                self.check_value(&variable, to)?;
                let duration = match string(d, "duration_intent")? {
                    "brief" => 1.8,
                    "normal" => 3.2,
                    "extended" => 5.4,
                    _ => return Err("Unsupported animation duration".into()),
                };
                let easing = string(d, "easing")?;
                if !matches!(easing, "linear" | "ease_in_out") {
                    return Err("Unsupported easing".into());
                }
                if from == to {
                    self.cursor += 1;
                    self.narration = frame.narration;
                    return Ok(());
                }
                self.animation = Some(Animation {
                    variable,
                    from,
                    to,
                    duration,
                    elapsed: 0.0,
                    easing: easing.into(),
                });
            }
            _ => unreachable!(),
        }
        self.narration = frame.narration;
        self.cursor += 1;
        Ok(())
    }
    pub fn tick(&mut self, seconds: f64) -> Result<(), String> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err("Invalid elapsed time".into());
        }
        if let Some(mut a) = self.animation.clone() {
            a.elapsed = (a.elapsed + seconds).min(a.duration);
            let t = a.elapsed / a.duration;
            let p = if a.easing == "ease_in_out" {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                }
            } else {
                t
            };
            self.set_variable(&a.variable, a.from + (a.to - a.from) * p)?;
            self.animation = if t == 1.0 { None } else { Some(a) };
        }
        Ok(())
    }
    fn require_anchor(&self, id: &str) -> Result<(), String> {
        if self
            .nodes
            .iter()
            .chain(self.groups.iter())
            .any(|v| v["id"] == id)
        {
            Ok(())
        } else {
            Err(format!("Unknown node or group {id}"))
        }
    }
    pub(crate) fn require_focus(&self, id: &str) -> Result<(), String> {
        if self.connections.iter().any(|v| v["id"] == id) {
            Ok(())
        } else {
            self.require_anchor(id)
        }
    }
    fn require_target(&self, target: &Value) -> Result<(), String> {
        // Match the existing semantic reducer: target ownership is validated here;
        // fragment validation belongs to canonical schema validation.
        for (key, objects) in [
            ("node_id", &self.nodes),
            ("connection_id", &self.connections),
            ("group_id", &self.groups),
        ] {
            if let Some(id) = target[key].as_str() {
                return if objects.iter().any(|v| v["id"] == id) {
                    Ok(())
                } else {
                    Err(format!("Unknown target {id}"))
                };
            }
        }
        Err("Missing target".into())
    }
    fn require_node(&self, id: &str) -> Result<&Value, String> {
        self.nodes
            .iter()
            .find(|n| n["id"] == id)
            .ok_or_else(|| format!("Unknown node {id}"))
    }
    fn check_value(&self, name: &str, value: f64) -> Result<(), String> {
        let d = self
            .declarations
            .iter()
            .find(|d| d["as"] == name)
            .ok_or("Unknown variable")?;
        if !value.is_finite()
            || d["min"].as_f64().is_some_and(|min| value < min)
            || d["max"].as_f64().is_some_and(|max| value > max)
        {
            return Err("Variable outside declared bounds".into());
        }
        Ok(())
    }
    /// Web ReflectionSnapshot list: (id, prompt, answer, anchor node id).
    /// They become available with the after-lesson window (`complete`).
    pub fn reflections(&self) -> Vec<(String, String, String, String)> {
        self.reflections
            .iter()
            .filter_map(|r| {
                Some((
                    r["as"].as_str()?.to_owned(),
                    r["prompt"].as_str()?.to_owned(),
                    r["answer"].as_str()?.to_owned(),
                    r["anchor"].as_str()?.to_owned(),
                ))
            })
            .collect()
    }
    pub fn variable_declarations(&self) -> &[Value] {
        &self.declarations
    }
    pub fn set_variable(&mut self, name: &str, value: f64) -> Result<(), String> {
        self.check_value(name, value)?;
        let mut values = self.variables.clone();
        values.insert(name.into(), value);
        let mut nodes = self.nodes.clone();
        for n in &mut nodes {
            bind(&mut n["content"], &values)?;
        }
        self.variables = values;
        self.nodes = nodes;
        Ok(())
    }
}
fn bind(content: &mut Value, values: &Variables) -> Result<(), String> {
    let bindings = content["bindings"].as_array().cloned().unwrap_or_default();
    // Content is re-evaluated in place, so clear any earlier "undefined" mark.
    for b in bindings.iter().filter(|b| b["hide_when_undefined"] == true) {
        let id = b["target"].as_str().and_then(|t| t.rsplit_once('.')).map(|(id, _)| id);
        if let Some(points) = content.get_mut("points").and_then(Value::as_array_mut) {
            for point in points.iter_mut().filter(|p| p["id"].as_str() == id) {
                if let Some(o) = point.as_object_mut() {
                    o.remove("binding_undefined");
                }
            }
        }
    }
    for b in bindings {
        let target = string(&b, "target")?;
        let (id, field) = target.rsplit_once('.').ok_or("Invalid binding target")?;
        let value = if b["hide_when_undefined"] == true {
            // A point with no defined position (e.g. the intersection of two
            // parallel lines) is hidden instead of failing the lesson.
            match evaluate(string(&b, "expression")?, values) {
                Ok(v) if v.is_finite() => v,
                _ => {
                    for point in content
                        .get_mut("points")
                        .and_then(Value::as_array_mut)
                        .into_iter()
                        .flatten()
                        .filter(|p| p["id"] == id)
                    {
                        point["binding_undefined"] = Value::Bool(true);
                    }
                    continue;
                }
            }
        } else {
            evaluate(string(&b, "expression")?, values)?
        };
        let mut found = false;
        // Union of the web OLL_BINDING_CAPABILITIES collections; the canonical
        // validator already restricts each collection to its node kind.
        for (key, fields) in [
            ("points", &["x", "y"][..]),
            ("circles", &["radius"][..]),
            ("arcs", &["radius", "start_angle", "end_angle"][..]),
            ("guides", &["value"][..]),
            ("sections", &["value"][..]),
        ] {
            if let Some(items) = content.get_mut(key).and_then(Value::as_array_mut) {
                for item in items {
                    if item["id"] == id {
                        if !fields.contains(&field) {
                            return Err(format!("Property '{field}' cannot be bound on '{key}'"));
                        }
                        item[field] = Value::from(value);
                        found = true;
                    }
                }
            }
        }
        if !found {
            return Err(format!("Unknown binding target {target}"));
        }
    }
    Ok(())
}
