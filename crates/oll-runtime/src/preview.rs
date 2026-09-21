//! Restricted canonical playback slice for native renderer validation.
//! The host owns pacing. This is not the production narration scheduler.
use crate::expression::{evaluate, Variables};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug)]
pub struct Frame {
    pub narration: String,
    pub action: Value,
}
#[derive(Clone, Debug)]
pub struct Preview {
    pub title: String,
    pub summary: String,
    pub variables: Variables,
    pub nodes: Vec<Value>,
    pub connections: Vec<Value>,
    pub focus: Vec<String>,
    pub narration: String,
    pub cursor: usize,
    frames: Vec<Frame>,
    declarations: Vec<Value>,
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
        let events: Vec<Value> = source
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        if events.len() < 2
            || events[0]["event"] != "lesson.open"
            || events.last().unwrap()["event"] != "lesson.close"
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
        for event in &events[1..events.len() - 1] {
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
                                | "lesson.variable.animate"
                        ) {
                            return Err(format!("Preview does not yet support {op}"));
                        }
                        if !ids.insert(string(action, "action_id")?.to_owned()) {
                            return Err("Duplicate action id".into());
                        }
                        if op == "board.create"
                            && !matches!(action["node"]["kind"].as_str(), Some("geometry" | "plot"))
                        {
                            return Err("Preview supports geometry and plot nodes only".into());
                        }
                        frames.push(Frame {
                            narration: if phase == "during_speech" {
                                beat["narration"]["text"].as_str().unwrap_or("").into()
                            } else {
                                String::new()
                            },
                            action: action.clone(),
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
            focus: Vec::new(),
            narration: String::new(),
            cursor: 0,
            frames,
            declarations,
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
    pub fn action_count(&self) -> usize {
        self.frames.len()
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
                    self.require_node(anchor)?;
                }
                let mut node = node.clone();
                bind(&mut node["content"], &self.variables)?;
                self.nodes.push(node);
            }
            "board.connect" => {
                let c = &a["connection"];
                for end in ["from", "to"] {
                    let n = self.require_node(string(&c[end], "node_id")?)?;
                    if let Some(fragment) = c[end]["fragment_id"].as_str() {
                        if !["points", "curves", "circles", "segments", "arcs"]
                            .iter()
                            .any(|k| {
                                n["content"][k]
                                    .as_array()
                                    .is_some_and(|xs| xs.iter().any(|x| x["id"] == fragment))
                            })
                        {
                            return Err("Unknown connection fragment".into());
                        }
                    }
                }
                self.connections.push(c.clone());
            }
            "board.focus" => {
                let targets = array(&a["focus"], "targets")?;
                for target in targets {
                    self.require_node(target.as_str().ok_or("Invalid focus")?)?;
                }
                self.focus = targets
                    .iter()
                    .map(|v| v.as_str().unwrap().to_owned())
                    .collect();
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
    for b in bindings {
        let target = string(&b, "target")?;
        let (id, field) = target.rsplit_once('.').ok_or("Invalid binding target")?;
        if !matches!(field, "x" | "y" | "end_angle" | "start_angle" | "radius") {
            return Err(format!("Unsupported binding field {field}"));
        }
        let value = evaluate(string(&b, "expression")?, values)?;
        let mut found = false;
        for key in ["points", "arcs", "circles"] {
            if let Some(items) = content.get_mut(key).and_then(Value::as_array_mut) {
                for item in items {
                    if item["id"] == id {
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
