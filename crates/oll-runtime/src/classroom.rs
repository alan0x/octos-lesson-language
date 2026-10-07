//! One long-lived classroom from several lessons (web oll-artifacts.ts
//! composeOllClassroomEvents / namespaceCanonicalLesson): every answer on a
//! board, and every answer added to a course pack, becomes a topic of a
//! single incremental lesson. Lessons after the first get namespaced
//! variables and tasks so two turns may both use `x` without sharing state.
use serde_json::{json, Map, Value};

/// Web stableIdentifierHash: two 32-bit FNV-style lanes over UTF-16 units.
pub fn stable_identifier_hash(value: &str) -> String {
    let (mut left, mut right) = (0x811c_9dc5u32, 0x9e37_79b9u32);
    for unit in value.encode_utf16() {
        left = (left ^ unit as u32).wrapping_mul(0x0100_0193);
        right = (right ^ unit as u32).wrapping_mul(0x85eb_ca6b);
    }
    format!("{left:08x}{right:08x}")
}

/// Web scopedIdentifier: `<namespace>_<value>`, hashed down past 64 chars.
pub fn scoped_identifier(namespace: &str, value: &str) -> String {
    let direct = format!("{namespace}_{value}");
    if direct.encode_utf16().count() <= 64 {
        return direct;
    }
    let head: String = String::from_utf16_lossy(&value.encode_utf16().take(35).collect::<Vec<_>>());
    format!("{namespace}_{head}_{}", &stable_identifier_hash(value)[..8])
}

type Names = Vec<(String, String)>;

fn lookup<'a>(names: &'a Names, alias: &str) -> Option<&'a str> {
    let key = alias.to_lowercase();
    names.iter().find(|(k, _)| *k == key).map(|(_, v)| v.as_str())
}

/// Web replaceExpressionVariables: identifiers `[a-z][a-z0-9_]*` (case
/// insensitive) are renamed when they are lesson variables.
fn replace_expression_variables(expression: &str, names: &Names) -> String {
    let chars: Vec<char> = expression.chars().collect();
    let mut out = String::with_capacity(expression.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_alphabetic() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            out.push_str(lookup(names, &ident).unwrap_or(&ident));
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn namespace_content_variables(value: &mut Value, names: &Names) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|v| namespace_content_variables(v, names)),
        Value::Object(record) => {
            if let Some(Value::String(v)) = record.get("variable") {
                let renamed = lookup(names, v).map(str::to_owned);
                if let Some(r) = renamed {
                    record.insert("variable".into(), Value::String(r));
                }
            }
            if let Some(Value::String(e)) = record.get("expression") {
                let renamed = replace_expression_variables(e, names);
                record.insert("expression".into(), Value::String(renamed));
            }
            for child in record.values_mut() {
                namespace_content_variables(child, names);
            }
        }
        _ => {}
    }
}

fn scoped_values(values: &Value, names: &Names) -> Value {
    let Some(map) = values.as_object() else { return values.clone() };
    Value::Object(
        map.iter()
            .map(|(alias, v)| (lookup(names, alias).unwrap_or(alias).to_owned(), v.clone()))
            .collect::<Map<_, _>>(),
    )
}

fn for_each_action(events: &mut [Value], mut f: impl FnMut(&mut Value)) {
    for event in events {
        let Some(beats) = event["step"]["beats"].as_array_mut() else { continue };
        for beat in beats {
            let Some(stage) = beat["stage"].as_object_mut() else { continue };
            for actions in stage.values_mut() {
                for action in actions.as_array_mut().into_iter().flatten() {
                    f(action);
                }
            }
        }
    }
}

/// Web namespaceCanonicalLesson.
pub fn namespace_lesson(events: &[Value], identity: &str) -> Vec<Value> {
    let mut result = events.to_vec();
    let Some(open) = result.iter_mut().find(|e| e["event"] == "lesson.open") else { return result };
    if !open["lesson"].is_object() {
        return result;
    }
    let namespace = format!("v{}", stable_identifier_hash(identity));
    let lesson = &mut open["lesson"];
    let names: Names = lesson["variables"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["as"].as_str())
        .map(|alias| (alias.to_lowercase(), scoped_identifier(&namespace, alias)))
        .collect();
    for variable in lesson["variables"].as_array_mut().into_iter().flatten() {
        if let Some(alias) = variable["as"].as_str() {
            if let Some(scoped) = lookup(&names, alias) {
                variable["as"] = json!(scoped);
            }
        }
    }
    for task in lesson["tasks"].as_array_mut().into_iter().flatten() {
        if let Some(alias) = task["as"].as_str() {
            task["as"] = json!(scoped_identifier(&namespace, alias));
        }
        if task["start"].is_object() {
            if let Some(vars) = task["start"]["variables"].as_array() {
                let renamed: Vec<Value> = vars
                    .iter()
                    .map(|a| a.as_str().map_or(a.clone(), |a| json!(lookup(&names, a).unwrap_or(a))))
                    .collect();
                task["start"]["variables"] = Value::Array(renamed);
            }
            if task["start"]["values"].is_object() {
                task["start"]["values"] = scoped_values(&task["start"]["values"], &names);
            }
        }
        for op in task["allowed_operations"].as_array_mut().into_iter().flatten() {
            if op["kind"] != "variable_change" {
                continue;
            }
            if let Some(v) = op["variable"].as_str() {
                op["variable"] = json!(lookup(&names, v).unwrap_or(v));
            }
        }
        if task["completion"]["kind"] == "expression_target" {
            if let Some(e) = task["completion"]["expression"].as_str() {
                task["completion"]["expression"] = json!(replace_expression_variables(e, &names));
            }
        }
    }
    for_each_action(&mut result, |action| {
        if action["transition"].is_object() {
            action["transition"]["values"] = scoped_values(&action["transition"]["values"], &names);
        }
        if action["animation"].is_object() {
            if let Some(v) = action["animation"]["variable"].as_str() {
                action["animation"]["variable"] = json!(lookup(&names, v).unwrap_or(v));
            }
        }
        if action["node"].is_object() {
            namespace_content_variables(&mut action["node"]["content"], &names);
        }
        if action["revision"].is_object() {
            namespace_content_variables(&mut action["revision"]["content"], &names);
        }
    });
    result
}

/// Web composeOllClassroomEvents: the first lesson's open (renamed to the
/// session's classroom, all variables and tasks), then every lesson's Steps
/// with board nodes placed in their topic region. No lesson.close: the
/// classroom stays open for the next answer.
pub fn compose(lessons: &[Vec<Value>], session_id: &str) -> Vec<Value> {
    let classroom: Vec<Vec<Value>> = lessons
        .iter()
        .enumerate()
        .map(|(i, lesson)| {
            let open = lesson.iter().find(|e| e["event"] == "lesson.open");
            match open.and_then(|o| o["lesson_id"].as_str()) {
                Some(id) if i > 0 => namespace_lesson(lesson, id),
                _ => lesson.clone(),
            }
        })
        .collect();
    let Some(first_open) = classroom.first().and_then(|l| l.iter().find(|e| e["event"] == "lesson.open")).cloned() else {
        return vec![];
    };
    let lesson_id = format!("learning-session-{session_id}");
    let mut head = first_open.clone();
    head["lesson_id"] = json!(lesson_id);
    head["sequence"] = json!(0);
    head["board"] = json!({
        "board_id": format!("learning-board-{session_id}"),
        "base_revision": 0,
        "region_intent": "new_topic",
    });
    let collect = |key: &str| -> Vec<Value> {
        classroom
            .iter()
            .flat_map(|l| {
                l.iter()
                    .find(|e| e["event"] == "lesson.open")
                    .and_then(|o| o["lesson"][key].as_array().cloned())
                    .unwrap_or_default()
            })
            .collect()
    };
    if head["lesson"].is_object() {
        head["lesson"]["variables"] = Value::Array(collect("variables"));
        head["lesson"]["tasks"] = Value::Array(collect("tasks"));
    }
    let mut result = vec![head];
    let region_of = |open: &Value| {
        open["board"]["region_id"].as_str().or(open["lesson_id"].as_str()).unwrap_or("").to_owned()
    };
    let mut active_region = region_of(&first_open);
    for lesson in &classroom {
        if let Some(open) = lesson.iter().find(|e| e["event"] == "lesson.open") {
            if open["board"]["region_intent"] == "new_topic" {
                active_region = region_of(open);
            } else if let Some(r) = open["board"]["region_id"].as_str() {
                active_region = r.to_owned();
            }
        }
        for event in lesson.iter().filter(|e| e["event"] == "lesson.step") {
            let mut step = event.clone();
            step["lesson_id"] = json!(lesson_id);
            step["sequence"] = json!(result.len());
            let mut one = [step];
            for_each_action(&mut one, |action| {
                if action["op"] == "board.create" && action["node"].is_object() && action["node"]["region_id"].is_null() {
                    action["node"]["region_id"] = json!(active_region);
                }
            });
            let [step] = one;
            result.push(step);
        }
    }
    result
}

/// Web loadOllLessonArtifact host for an answer on a learning session:
/// (lesson id, board id, base revision, region intent, region id).
pub fn live_host(session_id: &str, turn_id: &str, authoring: &Value) -> crate::authoring::Host {
    // ollArtifactIdentity: encodeURIComponent of the final artifact name.
    let identity: String = format!("{turn_id}.octos-lesson.json")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
                c.to_string()
            } else {
                c.to_string().bytes().map(|b| format!("%{b:02X}")).collect()
            }
        })
        .collect();
    let context = &authoring["board_context"];
    crate::authoring::Host {
        lesson_id: format!("learn-{session_id}-{identity}"),
        board_id: format!("learning-board-{session_id}"),
        base_revision: context["revision"].as_i64().unwrap_or(0),
        region_intent: if context.is_object() { "continue_topic" } else { "new_topic" }.into(),
        region_id: Some(format!("topic-{identity}")),
    }
}

/// Canonical events -> JSONL.
pub fn to_jsonl(events: &[Value]) -> String {
    events.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_web() {
        // Values from the web stableIdentifierHash (node).
        assert_eq!(stable_identifier_hash(""), "811c9dc59e3779b9");
        assert_eq!(stable_identifier_hash("x").len(), 16);
    }

    #[test]
    fn expression_identifiers_are_scoped() {
        let names = vec![("x".to_owned(), "v1_x".to_owned()), ("theta".to_owned(), "v1_theta".to_owned())];
        assert_eq!(replace_expression_variables("2*x + sin(Theta) - x2", &names), "2*v1_x + sin(v1_theta) - x2");
    }

    #[test]
    fn compose_renames_and_regions() {
        let open = |id: &str, var: &str| json!({"event":"lesson.open","lesson_id":id,"sequence":0,"board":{"board_id":"b","base_revision":0,"region_intent":"new_topic","region_id":format!("topic-{id}")},"lesson":{"title":id,"variables":[{"as":var}],"tasks":[]}});
        let step = |id: &str, var: &str| json!({"event":"lesson.step","lesson_id":"x","sequence":1,"step":{"id":id,"beats":[{"id":format!("{id}-b"),"stage":{"before_speech":[{"op":"board.create","node":{"id":format!("{id}-n"),"content":{"variable":var}}}],"during_speech":[],"after_speech":[]}}]}});
        let a = vec![open("a", "x"), step("s1", "x")];
        let b = vec![open("b", "x"), step("s2", "x")];
        let c = compose(&[a, b], "S");
        assert_eq!(c.len(), 3);
        assert_eq!(c[0]["lesson_id"], "learning-session-S");
        let scoped = c[0]["lesson"]["variables"][1]["as"].as_str().unwrap().to_owned();
        assert!(scoped.starts_with('v') && scoped.ends_with("_x"));
        assert_eq!(c[2]["step"]["beats"][0]["stage"]["before_speech"][0]["node"]["content"]["variable"], json!(scoped));
        assert_eq!(c[1]["step"]["beats"][0]["stage"]["before_speech"][0]["node"]["region_id"], "topic-a");
        assert_eq!(c[2]["step"]["beats"][0]["stage"]["before_speech"][0]["node"]["region_id"], "topic-b");
        assert_eq!(c[2]["sequence"], 2);
    }
}
