use oll_runtime::{
    session::{compile_operations, Session},
    timing::{narration_ms, operation_ms},
};
use serde_json::Value;
const SOURCE: &str = include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl");
fn reference() -> Value {
    serde_json::from_str(include_str!("fixtures/typescript-reference.json")).unwrap()
}
#[test]
fn matches_typescript_operations_and_timing() {
    let r = reference();
    let ops = compile_operations(SOURCE).unwrap();
    assert_eq!(serde_json::json!(ops), r["operations"]);
    for (op, expected) in ops.iter().zip(r["delays_ms"].as_array().unwrap()) {
        assert_eq!(operation_ms(op), expected.as_f64().unwrap());
    }
    for s in r["narrations"].as_array().unwrap() {
        assert_eq!(
            narration_ms(s["text"].as_str().unwrap(), s["delivery"].as_str().unwrap()),
            s["ms"].as_f64().unwrap()
        );
    }
}
#[test]
fn pause_during_animation_and_narration_wait_and_restart() {
    let mut s = Session::load(SOURCE).unwrap();
    s.play().unwrap();
    while !s.board.animating() {
        s.tick(0.01).unwrap();
    }
    s.tick(1.0).unwrap();
    s.pause();
    let theta = s.board.variables["theta"];
    let cursor = s.cursor;
    s.tick(100.0).unwrap();
    assert_eq!(theta, s.board.variables["theta"]);
    assert_eq!(cursor, s.cursor);
    s.play().unwrap();
    s.tick(5.0).unwrap();
    assert!(!s.board.animating());
    assert!(!s.board.narration.is_empty());
    assert_eq!(s.board.cursor, 4); // after_speech focus must wait for narration
    s.pause();
    s.tick(100.0).unwrap();
    assert_eq!(s.board.cursor, 4);
    s.play().unwrap();
    s.tick(100.0).unwrap();
    assert!(s.complete());
    assert!(!s.playing);
    let r = reference();
    let expected = &r["final_state"];
    for node in &s.board.nodes {
        assert_json_numbers(node, &expected["nodes"][node["id"].as_str().unwrap()]);
    }
    assert_eq!(s.committed_steps.len(), 1);
    assert_eq!(s.board.focus.len(), 2);
    s = Session::load(SOURCE).unwrap();
    assert_eq!(s.cursor, 0);
    assert!(s.board.nodes.is_empty());
    assert_eq!(s.board.variables["theta"], 0.0);
}
#[test]
fn elapsed_time_chunking_does_not_change_schedule() {
    let mut a = Session::load(SOURCE).unwrap();
    let mut b = a.clone();
    a.play().unwrap();
    b.play().unwrap();
    a.tick(7.0).unwrap();
    for _ in 0..700 {
        b.tick(0.01).unwrap();
    }
    assert_eq!(a.cursor, b.cursor);
    assert!((a.board.variables["theta"] - b.board.variables["theta"]).abs() < 1e-10);
    a.tick(100.0).unwrap();
    b.tick(100.0).unwrap();
    assert!(a.complete() && b.complete());
    assert_eq!(a.board.nodes, b.board.nodes);
}
#[test]
fn duplicate_step_and_beat_ids_are_rejected() {
    let original: Vec<Value> = SOURCE
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let mut events = original.clone();
    let mut step = events[1].clone();
    step["step"]["beats"] = serde_json::json!([]);
    events.insert(2, step);
    events[2]["sequence"] = 2.into();
    events[3]["sequence"] = 3.into();
    let encode = |events: &Vec<Value>| {
        events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert!(Session::load(&encode(&events))
        .unwrap_err()
        .contains("Duplicate step id"));
    events = original;
    let mut beat = events[1]["step"]["beats"][0].clone();
    beat["stage"] = serde_json::json!({"before_speech":[],"during_speech":[],"after_speech":[]});
    events[1]["step"]["beats"]
        .as_array_mut()
        .unwrap()
        .push(beat);
    assert!(Session::load(&encode(&events))
        .unwrap_err()
        .contains("Duplicate beat id"));
}

// JSON has a single number type; serde_json stores integer and floating encodings
// separately. Compare numeric values exactly, while retaining structural checks.
fn assert_json_numbers(a: &Value, b: &Value) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => assert_eq!(x.as_f64(), y.as_f64()),
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len());
            for (a, b) in x.iter().zip(y) {
                assert_json_numbers(a, b);
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            assert_eq!(x.keys().collect::<Vec<_>>(), y.keys().collect::<Vec<_>>());
            for (k, v) in x {
                assert_json_numbers(v, &y[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}
#[test]
fn timeline_matches_executed_typescript_session_within_one_animation_frame() {
    let r = reference();
    let expected = r["timeline"].as_array().unwrap();
    let mut s = Session::load(SOURCE).unwrap();
    s.play().unwrap();
    let mut at = 0.0;
    let mut seen = 0;
    loop {
        if s.cursor > seen {
            let e = &expected[seen];
            assert_eq!(s.cursor, e["cursor"].as_u64().unwrap() as usize);
            assert!(
                (at - e["ms"].as_f64().unwrap()).abs() <= 16.01,
                "cursor {}: rust {}, TS {}",
                s.cursor,
                at,
                e["ms"]
            );
            seen = s.cursor;
        }
        if s.complete() {
            break;
        }
        s.tick(0.001).unwrap();
        at += 1.0;
        assert!(at < 100000.0);
    }
    assert_eq!(seen, expected.len());
}

const QUADRATIC: &str = include_str!("../../../examples/quadratic/lesson.canonical.jsonl");
fn compare_board(p: &oll_runtime::preview::Preview, expected: &Value) {
    for (objects, key) in [
        (&p.nodes, "nodes"),
        (&p.connections, "connections"),
        (&p.groups, "groups"),
    ] {
        assert_eq!(objects.len(), expected[key].as_object().unwrap().len());
        for object in objects {
            assert_json_numbers(object, &expected[key][object["id"].as_str().unwrap()]);
        }
    }
    assert_eq!(serde_json::json!(p.focus), expected["focus"]);
}
#[test]
fn quadratic_every_action_matches_typescript_and_pauses_without_losing_state() {
    let r: Value = serde_json::from_str(include_str!("fixtures/quadratic-reference.json")).unwrap();
    assert_eq!(
        serde_json::json!(compile_operations(QUADRATIC).unwrap()),
        r["operations"]
    );
    let mut p = oll_runtime::preview::Preview::load(QUADRATIC).unwrap();
    for expected in r["states"].as_array().unwrap() {
        p.advance().unwrap();
        compare_board(&p, expected);
    }
    assert!(p.complete());
    let mut s = Session::load(QUADRATIC).unwrap();
    s.play().unwrap();
    while s.board.cursor < 11 {
        s.tick(0.1).unwrap();
    }
    s.pause();
    let frozen = format!("{s:?}");
    s.tick(3600.0).unwrap();
    assert_eq!(format!("{s:?}"), frozen);
    s.play().unwrap();
    s.tick(3600.0).unwrap();
    assert!(s.complete());
    compare_board(&s.board, &r["final_state"]);
    assert_eq!(
        serde_json::json!(s.committed_steps),
        r["final_state"]["applied_steps"]
    );
    let reset = Session::load(QUADRATIC).unwrap();
    assert!(reset.board.nodes.is_empty() && reset.board.groups.is_empty());
    assert!(reset.board.last_point.is_none());
}
#[test]
fn revision_replaces_content_and_bad_group_reference_is_rejected() {
    let mut events: Vec<Value> = QUADRATIC
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let node_id = events[1]["step"]["beats"][0]["stage"]["during_speech"][0]["node"]["id"].clone();
    events[1]["step"]["beats"][0]["stage"]["after_speech"] = serde_json::json!([{
        "action_id":"revision-test", "op":"board.revise", "target":{"node_id":node_id},
        "revision":{"content":{"fragments":[{"id":"replacement", "latex":"y=x^2"}]}}
    }]);
    events.truncate(2);
    events.push(serde_json::json!({"dsl":"octos.lesson","profile":"canonical","version":"0.1","lesson_id":"lesson-quadratic-001","sequence":2,"event":"lesson.close","result":{}}));
    let encode = |xs: &Vec<Value>| {
        xs.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    // Remove the second beat which refers to the deliberately replaced target-form node.
    events[1]["step"]["beats"]
        .as_array_mut()
        .unwrap()
        .truncate(1);
    let mut p = oll_runtime::preview::Preview::load(&encode(&events)).unwrap();
    p.advance().unwrap();
    p.advance().unwrap();
    assert_eq!(
        p.nodes[0]["content"],
        serde_json::json!({"fragments":[{"id":"replacement","latex":"y=x^2"}]})
    );
    events[1]["step"]["beats"][0]["stage"]["after_speech"][0] = serde_json::json!({"action_id":"bad-group","op":"board.group","group":{"id":"g","members":["missing"]}});
    assert!(Session::load(&encode(&events))
        .unwrap_err()
        .contains("Unknown node or group"));
}
