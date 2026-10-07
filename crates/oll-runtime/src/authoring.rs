//! Authoring -> Canonical materialization for live lessons, ported from
//! octos-learn `learning/oll/oll-materialization.ts` (materializeOllLesson:
//! removeRedundantStandaloneMath + core normalizeAuthoringLesson). Course
//! packs are produced by the same function, so a generated lesson becomes the
//! same canonical JSONL the native player already loads.
//!
//! Schema/semantic validation stays on the server: Learning Coach validates
//! every lesson before delivering it ("Validated OLL lesson ..."). Here only
//! the reference checks the normalizer itself needs are enforced.
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

/// Web OllLessonMaterializationOptions.
#[derive(Clone, Debug)]
pub struct Host {
    pub lesson_id: String,
    pub board_id: String,
    pub base_revision: i64,
    /// "new_topic" | "continue_topic".
    pub region_intent: String,
    pub region_id: Option<String>,
}

#[derive(Clone, Debug)]
enum Kind {
    Node,
    Connection,
    Group,
}

#[derive(Clone, Debug)]
struct Entry {
    kind: Kind,
    id: String,
    fragment_ids: HashMap<String, String>,
}

const ADDRESSABLE: [&str; 13] = [
    "curves", "points", "guides", "regions", "elements", "edges", "polygons", "circles", "segments", "arcs", "objects",
    "sections", "highlights",
];

/// Materialize an authoring lesson into canonical events.
pub fn materialize(authoring: &Value, host: &Host) -> Result<Vec<Value>, String> {
    let authoring = remove_redundant_standalone_math(authoring);
    normalize(&authoring, host)
}

/// Canonical JSONL (one event per line), the format `Session::load` reads.
pub fn materialize_jsonl(authoring: &Value, host: &Host) -> Result<String, String> {
    Ok(materialize(authoring, host)?
        .iter()
        .map(|e| e.to_string())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn stable_id(host: &Host, kind: &str, alias: &str) -> String {
    format!("{}:{kind}:{alias}", host.lesson_id)
}

fn arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn actions(doc: &Value) -> impl Iterator<Item = &Value> {
    arr(&doc["steps"]).iter().flat_map(|s| arr(&s["beats"]).iter()).flat_map(|b| arr(&b["actions"]).iter())
}

fn build_registry(doc: &Value, host: &Host) -> HashMap<String, Entry> {
    let mut registry = HashMap::new();
    for r in arr(&doc["board_context"]["references"]) {
        let kind = match r["type"].as_str() {
            Some("connection") => Kind::Connection,
            Some("group") => Kind::Group,
            _ => Kind::Node,
        };
        let fragment_ids = arr(&r["fragments"])
            .iter()
            .filter_map(|f| Some((f["as"].as_str()?.to_owned(), f["target_id"].as_str()?.to_owned())))
            .collect();
        if let (Some(alias), Some(id)) = (r["as"].as_str(), r["target_id"].as_str()) {
            registry.insert(alias.to_owned(), Entry { kind, id: id.to_owned(), fragment_ids });
        }
    }
    for a in actions(doc) {
        let Some(alias) = a["as"].as_str() else { continue };
        let kind = match a["do"].as_str() {
            Some("write") => Kind::Node,
            Some("connect") => Kind::Connection,
            Some("group") => Kind::Group,
            _ => continue,
        };
        let type_name = match kind {
            Kind::Node => "node",
            Kind::Connection => "connection",
            Kind::Group => "group",
        };
        registry.insert(
            alias.to_owned(),
            Entry { kind, id: stable_id(host, type_name, alias), fragment_ids: HashMap::new() },
        );
    }
    registry
}

fn split_target(value: &str) -> Result<(&str, Option<&str>), String> {
    let mut parts = value.split('#');
    let alias = parts.next().unwrap_or("");
    let fragment = parts.next();
    if alias.is_empty() || parts.next().is_some() || fragment == Some("") {
        return Err(format!("OLL_INVALID_REFERENCE: Invalid reference '{value}'"));
    }
    Ok((alias, fragment))
}

fn canonical_target(registry: &HashMap<String, Entry>, value: &Value) -> Result<Value, String> {
    let value = value.as_str().ok_or("OLL_INVALID_REFERENCE: Reference must be a string")?;
    let (alias, fragment) = split_target(value)?;
    let entry = registry.get(alias).ok_or_else(|| format!("OLL_REFERENCE_NOT_FOUND: Unknown alias '{alias}'"))?;
    Ok(match entry.kind {
        Kind::Group => json!({ "group_id": entry.id }),
        Kind::Connection => json!({ "connection_id": entry.id }),
        Kind::Node => {
            let mut t = json!({ "node_id": entry.id });
            if let Some(f) = fragment {
                let id = entry.fragment_ids.get(f).cloned().unwrap_or_else(|| format!("{}:fragment:{f}", entry.id));
                t["fragment_id"] = json!(id);
            }
            t
        }
    })
}

fn require_id(target: &Value) -> Result<String, String> {
    ["node_id", "group_id", "connection_id"]
        .iter()
        .find_map(|k| target[*k].as_str())
        .map(str::to_owned)
        .ok_or_else(|| "OLL_REFERENCE_NOT_FOUND: Canonical target has no addressable ID".into())
}

fn require_registry_id(registry: &HashMap<String, Entry>, alias: &Value) -> Result<String, String> {
    alias
        .as_str()
        .and_then(|a| registry.get(a))
        .map(|e| e.id.clone())
        .ok_or_else(|| format!("OLL_REFERENCE_NOT_FOUND: No canonical ID exists for alias '{alias}'"))
}

/// Web normalizeAddressableContent: fragment aliases become `<node>:fragment:<as>`
/// ids (with cross-references inside the content rewritten the same way) and
/// binding targets become fragment ids.
fn normalize_content(node_id: &str, content: &Value) -> Result<Value, String> {
    let mut clone = content.clone();
    let frag = |alias: &Value| json!(format!("{node_id}:fragment:{}", alias.as_str().unwrap_or("")));
    let mut fields = vec!["fragments"];
    fields.extend(ADDRESSABLE);
    for field in fields {
        let Some(items) = clone.get(field).and_then(Value::as_array).cloned() else { continue };
        let mapped = items
            .into_iter()
            .map(|item| {
                let Some(alias) = item.get("as").filter(|a| !a.is_null() && *a != false).cloned() else { return item };
                let mut normalized = Map::new();
                normalized.insert("id".into(), frag(&alias));
                if let Some(obj) = item.as_object() {
                    for (k, v) in obj {
                        if k != "as" {
                            normalized.insert(k.clone(), v.clone());
                        }
                    }
                }
                match field {
                    "edges" | "segments" => {
                        normalized.insert("from".into(), frag(&item["from"]));
                        normalized.insert("to".into(), frag(&item["to"]));
                    }
                    "circles" | "arcs" => {
                        normalized.insert("center".into(), frag(&item["center"]));
                    }
                    "polygons" if item["points"].is_array() => {
                        normalized.insert("points".into(), Value::Array(arr(&item["points"]).iter().map(frag).collect()));
                    }
                    "points" if item["interaction"]["kind"] == "angle_control" => {
                        let mut interaction = item["interaction"].clone();
                        interaction["center"] = frag(&item["interaction"]["center"]);
                        normalized.insert("interaction".into(), interaction);
                    }
                    "regions" if item["members"].is_array() => {
                        normalized.insert("members".into(), Value::Array(arr(&item["members"]).iter().map(frag).collect()));
                    }
                    "sections" if item["targets"].is_array() => {
                        normalized.insert("targets".into(), Value::Array(arr(&item["targets"]).iter().map(frag).collect()));
                    }
                    _ => {}
                }
                Value::Object(normalized)
            })
            .collect();
        clone[field] = Value::Array(mapped);
    }
    if let Some(bindings) = clone.get("bindings").and_then(Value::as_array).cloned() {
        let mut out = Vec::new();
        for b in bindings {
            let target = b["target"].as_str().ok_or("OLL_INVALID_BINDING: Binding target must be a string")?;
            let sep = target.rfind('.').filter(|&i| i > 0 && i < target.len() - 1)
                .ok_or_else(|| format!("OLL_INVALID_BINDING: Invalid binding target '{target}'"))?;
            let (alias, property) = (&target[..sep], &target[sep + 1..]);
            let mut n = Map::new();
            n.insert("target".into(), json!(format!("{node_id}:fragment:{alias}.{property}")));
            n.insert("expression".into(), b["expression"].clone());
            if let Some(label) = b.get("label") {
                n.insert("label".into(), label.clone());
            }
            if b["allow_zero"] == true {
                n.insert("allow_zero".into(), json!(true));
            }
            if b["hide_when_undefined"] == true {
                n.insert("hide_when_undefined".into(), json!(true));
            }
            out.push(Value::Object(n));
        }
        clone["bindings"] = Value::Array(out);
    }
    Ok(clone)
}

fn normalize_placement(registry: &HashMap<String, Entry>, place: &Value) -> Result<Value, String> {
    let mut result = place.clone();
    if let Some(anchor) = place.get("anchor").filter(|a| a.as_str().is_some_and(|s| !s.is_empty())) {
        let id = require_id(&canonical_target(registry, anchor)?)?;
        if let Some(obj) = result.as_object_mut() {
            obj.shift_remove("anchor");
            obj.insert("anchor".into(), json!(id));
        }
    }
    Ok(result)
}

/// Web resolvePhaseStart (validation errors included: they decide replay values).
pub fn resolve_phase_start(policy: &Value, variables: &[Value], path: &str) -> Result<Value, String> {
    let fail = |m: &str| Err(format!("OLL_INVALID_PHASE_START {path}: {m}"));
    match policy["kind"].as_str() {
        Some("continue") => return Ok(json!({})),
        Some("replay") | Some("practice") => {}
        _ => return fail("Unknown phase kind"),
    }
    let selected = arr(&policy["variables"]);
    if selected.is_empty() {
        return fail("Independent phases require distinct selected variables");
    }
    let mut out = Map::new();
    for alias in selected {
        let alias = alias.as_str().unwrap_or("");
        let Some(variable) = variables.iter().find(|v| v["as"] == alias) else {
            return fail(&format!("Unknown start variable '{alias}'"));
        };
        let value = policy["values"].get(alias).unwrap_or(&variable["initial"]).clone();
        out.insert(alias.to_owned(), value);
    }
    Ok(Value::Object(out))
}

fn normalize_action(
    action: &Value,
    host: &Host,
    registry: &HashMap<String, Entry>,
    sequence: usize,
    beat_index: usize,
    action_index: usize,
) -> Result<Value, String> {
    let action_id = format!("{}:action:{sequence}:{}:{}", host.lesson_id, beat_index + 1, action_index + 1);
    let target = |key: &str| canonical_target(registry, &action[key]);
    Ok(match action["do"].as_str().unwrap_or("") {
        "write" => {
            let node_id = require_registry_id(registry, &action["as"])?;
            let mut node = Map::new();
            node.insert("id".into(), json!(node_id));
            node.insert("kind".into(), action["kind"].clone());
            node.insert("role".into(), action["role"].clone());
            node.insert("content".into(), normalize_content(&node_id, &action["content"])?);
            node.insert("placement".into(), normalize_placement(registry, &action["place"])?);
            if let Some(region) = &host.region_id {
                node.insert("region_id".into(), json!(region));
            }
            json!({ "action_id": action_id, "op": "board.create", "node": Value::Object(node) })
        }
        "emphasize" => json!({ "action_id": action_id, "op": "board.emphasize", "target": target("target")?, "emphasis": action["emphasis"] }),
        "point" => json!({ "action_id": action_id, "op": "teacher.point", "target": target("target")? }),
        "expression" => json!({ "action_id": action_id, "op": "teacher.expression", "expression": action["expression"] }),
        "animate" => json!({
            "action_id": action_id,
            "op": "lesson.variable.animate",
            "animation": {
                "variable": action["variable"],
                "to": action["value"],
                "easing": action.get("easing").filter(|v| !v.is_null()).cloned().unwrap_or(json!("linear")),
                "duration_intent": action.get("duration_intent").filter(|v| !v.is_null()).cloned().unwrap_or(json!("normal")),
            },
        }),
        "connect" => {
            let mut c = Map::new();
            c.insert("id".into(), json!(require_registry_id(registry, &action["as"])?));
            c.insert("from".into(), target("from")?);
            c.insert("to".into(), target("to")?);
            c.insert("relation".into(), action["relation"].clone());
            if action["label"].as_str().is_some_and(|s| !s.is_empty()) {
                c.insert("label".into(), action["label"].clone());
            }
            json!({ "action_id": action_id, "op": "board.connect", "connection": Value::Object(c) })
        }
        "group" => {
            let members = arr(&action["members"])
                .iter()
                .map(|m| require_id(&canonical_target(registry, m)?))
                .collect::<Result<Vec<_>, String>>()?;
            json!({
                "action_id": action_id,
                "op": "board.group",
                "group": {
                    "id": require_registry_id(registry, &action["as"])?,
                    "title": action["label"],
                    "role": action["role"],
                    "members": members,
                },
            })
        }
        "focus" => {
            let targets = arr(&action["targets"])
                .iter()
                .map(|t| require_id(&canonical_target(registry, t)?))
                .collect::<Result<Vec<_>, String>>()?;
            json!({ "action_id": action_id, "op": "board.focus", "focus": { "targets": targets, "intent": action["intent"] } })
        }
        "revise" => json!({
            "action_id": action_id,
            "op": "board.revise",
            "target": target("target")?,
            "revision": { "content": action["content"], "reason": action["reason"] },
        }),
        _ => return Err("OLL_INVALID_OPERATION: Unsupported authoring action".into()),
    })
}

fn event(host: &Host, name: &str, sequence: usize) -> Map<String, Value> {
    let mut e = Map::new();
    e.insert("dsl".into(), json!("octos.lesson"));
    e.insert("version".into(), json!("0.1"));
    e.insert("profile".into(), json!("canonical"));
    e.insert("event".into(), json!(name));
    e.insert("lesson_id".into(), json!(host.lesson_id));
    e.insert("sequence".into(), json!(sequence));
    e
}

/// Web normalizeAuthoringLesson (reference checks only; see module docs).
pub fn normalize(doc: &Value, host: &Host) -> Result<Vec<Value>, String> {
    if let Some(ctx) = doc.get("board_context").filter(|c| c.is_object()) {
        if ctx["board_id"] != host.board_id.as_str() {
            return Err("OLL_INVALID_REFERENCE: Board context does not match the host board".into());
        }
        if ctx["revision"].as_i64() != Some(host.base_revision) {
            return Err("OLL_INVALID_REFERENCE: Board context revision does not match the host revision".into());
        }
    }
    let registry = build_registry(doc, host);
    let variables = arr(&doc["lesson"]["variables"]).to_vec();
    let mut lesson = doc["lesson"].clone();
    if let Some(reflections) = lesson.get_mut("reflections").and_then(Value::as_array_mut) {
        for r in reflections {
            r["anchor"] = json!(require_registry_id(&registry, &r["anchor"])?);
        }
    }
    if let Some(tasks) = lesson.get_mut("tasks").and_then(Value::as_array_mut) {
        for task in tasks {
            if task.get("start").is_some_and(|s| s.is_object()) {
                let path = format!("/lesson/tasks/{}/start", task["as"].as_str().unwrap_or(""));
                task["start"]["values"] = resolve_phase_start(&task["start"], &variables, &path)?;
            }
            if task["completion"]["kind"] != "scene3d_view_target" {
                continue;
            }
            task["completion"]["node"] = json!(require_registry_id(&registry, &task["completion"]["node"])?);
            if let Some(ops) = task.get_mut("allowed_operations").and_then(Value::as_array_mut) {
                for op in ops {
                    op["node"] = json!(require_registry_id(&registry, &op["node"])?);
                }
            }
        }
    }
    let mut board = Map::new();
    board.insert("board_id".into(), json!(host.board_id));
    board.insert("base_revision".into(), json!(host.base_revision));
    board.insert("region_intent".into(), json!(host.region_intent));
    if let Some(region) = &host.region_id {
        board.insert("region_id".into(), json!(region));
    }
    let mut open = event(host, "lesson.open", 0);
    open.insert("board".into(), Value::Object(board));
    open.insert("lesson".into(), lesson);
    let mut events = vec![Value::Object(open)];

    let steps = arr(&doc["steps"]);
    for (step_index, step) in steps.iter().enumerate() {
        let sequence = step_index + 1;
        let step_id = stable_id(host, "step", step["key"].as_str().unwrap_or(""));
        let mut beats = Vec::new();
        for (beat_index, beat) in arr(&step["beats"]).iter().enumerate() {
            let mut stage: [Vec<Value>; 3] = Default::default();
            for (action_index, action) in arr(&beat["actions"]).iter().enumerate() {
                let slot = match action["when"].as_str() {
                    Some("before_speech") => 0,
                    Some("after_speech") => 2,
                    _ => 1,
                };
                stage[slot].push(normalize_action(action, host, &registry, sequence, beat_index, action_index)?);
            }
            let beat_key = beat["key"].as_str().unwrap_or("");
            if beat["start"]["kind"] == "replay" {
                let path = format!("/steps/{step_index}/beats/{beat_index}/start");
                stage[0].insert(
                    0,
                    json!({
                        "action_id": format!("{step_id}:beat:{beat_key}:phase-start"),
                        "op": "lesson.phase.start",
                        "transition": {
                            "kind": "replay",
                            "values": resolve_phase_start(&beat["start"], &variables, &path)?,
                            "source_path": path,
                        },
                    }),
                );
            }
            let mut b = Map::new();
            b.insert("id".into(), json!(format!("{step_id}:beat:{beat_key}")));
            if beat["say"].as_str().is_some_and(|s| !s.is_empty()) {
                let mut narration = Map::new();
                narration.insert("text".into(), beat["say"].clone());
                if beat.get("delivery").is_some_and(|d| !d.is_null()) {
                    narration.insert("delivery".into(), beat["delivery"].clone());
                }
                b.insert("narration".into(), Value::Object(narration));
            }
            let [before, during, after] = stage;
            b.insert("stage".into(), json!({ "before_speech": before, "during_speech": during, "after_speech": after }));
            beats.push(Value::Object(b));
        }
        let mut e = event(host, "lesson.step", sequence);
        let mut s = Map::new();
        s.insert("id".into(), json!(step_id));
        s.insert("purpose".into(), step["purpose"].clone());
        s.insert("beats".into(), Value::Array(beats));
        e.insert("step".into(), Value::Object(s));
        events.push(Value::Object(e));
    }

    let focus = arr(&doc["close"]["focus"])
        .iter()
        .map(|t| require_id(&canonical_target(&registry, t)?))
        .collect::<Result<Vec<_>, String>>()?;
    let mut close = event(host, "lesson.close", steps.len() + 1);
    close.insert(
        "result".into(),
        json!({
            "summary": doc["close"]["summary"].as_str().unwrap_or(""),
            "summary_node_refs": [],
            "suggested_focus": focus,
        }),
    );
    events.push(Value::Object(close));
    Ok(events)
}

// --- removeRedundantStandaloneMath ---------------------------------------

fn visit_strings<'a>(value: &'a Value, visit: &mut dyn FnMut(&'a str)) {
    match value {
        Value::String(s) => visit(s),
        Value::Array(a) => a.iter().for_each(|v| visit_strings(v, visit)),
        Value::Object(o) => o.values().for_each(|v| visit_strings(v, visit)),
        _ => {}
    }
}

/// The NFKC folding that matters for formula text: full-width ASCII forms and
/// the ideographic space. (No Unicode normalization crate is pinned here.)
fn fold_width(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            '\u{3000}' => ' ',
            _ => c,
        })
        .collect()
}

fn normalized_formula_keys(value: &str) -> Vec<String> {
    use regex::Regex;
    use std::sync::OnceLock;
    static RES: OnceLock<[Regex; 7]> = OnceLock::new();
    let [left_right, operatorname, text, function, product, punct, dashes] = RES.get_or_init(|| {
        [
            Regex::new(r"\\(?:left|right)").unwrap(),
            Regex::new(r"\\operatorname\{([^{}]+)\}").unwrap(),
            Regex::new(r"\\(?:mathrm|text)\{([^{}]+)\}").unwrap(),
            Regex::new(r"\\(sin|cos|tan|cot|sec|csc|log|ln|exp)\b").unwrap(),
            Regex::new(r"\\(?:cdot|times)").unwrap(),
            Regex::new(r"[{}()\[\]$\s,.;:，。；：]").unwrap(),
            Regex::new(r"[−–—]").unwrap(),
        ]
    });
    let s = fold_width(value).to_lowercase();
    let s = left_right.replace_all(&s, "");
    let s = operatorname.replace_all(&s, "$1");
    let s = text.replace_all(&s, "$1");
    let s = function.replace_all(&s, "$1");
    let s = product.replace_all(&s, "*");
    let s = punct.replace_all(&s, "");
    let s = dashes.replace_all(&s, "-");
    let normalized = s.replace('\\', "");
    if normalized.chars().count() < 3 {
        return vec![];
    }
    let mut keys = vec![normalized.clone()];
    if let Some(eq) = normalized.find('=') {
        let rhs = &normalized[eq + 1..];
        if rhs.chars().count() >= 3 && rhs != normalized {
            keys.push(rhs.to_owned());
        }
    }
    keys
}

fn action_formula_keys(action: &Value) -> HashSet<String> {
    let mut keys = HashSet::new();
    if action["content"].is_object() || action["content"].is_array() {
        visit_strings(&action["content"], &mut |s| keys.extend(normalized_formula_keys(s)));
    }
    keys
}

/// Web removeRedundantStandaloneMath: drop an unreferenced standalone math
/// card whose formula a richer visual in the same lesson already carries.
pub fn remove_redundant_standalone_math(authoring: &Value) -> Value {
    let mut result = authoring.clone();
    let richer = ["diagram", "geometry", "plot", "scene3d"];
    let visual: HashSet<String> = actions(&result)
        .filter(|a| a["kind"].as_str().is_some_and(|k| richer.contains(&k)))
        .flat_map(action_formula_keys)
        .collect();
    if visual.is_empty() {
        return result;
    }
    let mut counts: HashMap<String, usize> = HashMap::new();
    visit_strings(&result, &mut |s| *counts.entry(s.to_owned()).or_default() += 1);
    if let Some(steps) = result.get_mut("steps").and_then(Value::as_array_mut) {
        for step in steps {
            let Some(beats) = step.get_mut("beats").and_then(Value::as_array_mut) else { continue };
            for beat in beats {
                let Some(list) = beat.get("actions").and_then(Value::as_array) else { continue };
                let filtered: Vec<Value> = list
                    .iter()
                    .filter(|a| {
                        if a["do"] != "write" || a["kind"] != "math" {
                            return true;
                        }
                        let Some(alias) = a["as"].as_str().filter(|s| !s.is_empty()) else { return true };
                        if counts.get(alias).copied().unwrap_or(0) > 1 {
                            return true;
                        }
                        !action_formula_keys(a).iter().any(|k| visual.contains(k))
                    })
                    .cloned()
                    .collect();
                if !filtered.is_empty() {
                    beat["actions"] = Value::Array(filtered);
                }
            }
        }
    }
    result
}
