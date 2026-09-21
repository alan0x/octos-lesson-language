use oll_runtime::{checkpoint, session::Session};
use serde_json::{json, Value};
const CIRCLE: &str = include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl");
const QUADRATIC: &str = include_str!("../../../examples/quadratic/lesson.canonical.jsonl");
#[test]
fn imports_actual_legacy_checkpoints_and_matches_board() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/checkpoints-reference.json")).unwrap();
    for c in fixture["courses"].as_array().unwrap() {
        let source = if c["course"] == "quadratic" {
            QUADRATIC
        } else {
            CIRCLE
        };
        for saved in c["checkpoints"].as_array().unwrap() {
            let s = Session::restore(source, saved).unwrap();
            let b = &saved["projection"]["board"];
            for (key, objects) in [
                ("nodes", &s.board.nodes),
                ("connections", &s.board.connections),
                ("groups", &s.board.groups),
            ] {
                let map = objects
                    .iter()
                    .map(|v| (v["id"].as_str().unwrap().to_owned(), v.clone()))
                    .collect::<serde_json::Map<_, _>>();
                assert!(
                    checkpoint::equivalent(&Value::Object(map), &b[key]),
                    "{key} cursor {}",
                    s.cursor
                );
            }
            assert_eq!(json!(s.board.focus), b["focus"]);
            assert!(!s.playing);
        }
    }
    for c in fixture["stringify"].as_array().unwrap() {
        assert_eq!(
            checkpoint::stringify(&c["value"]),
            c["expected"].as_str().unwrap()
        );
    }
}
#[test]
fn native_restore_preserves_animation_and_wait_and_rejects_wrong_course() {
    for seconds in [0., 0.5, 3., 5., 8., 12., 20.] {
        let mut a = Session::load(CIRCLE).unwrap();
        a.play().unwrap();
        a.tick(seconds).unwrap();
        a.pause();
        let saved = a.checkpoint().unwrap();
        let mut b = Session::restore(CIRCLE, &saved).unwrap();
        assert_eq!(a.checkpoint().unwrap(), b.checkpoint().unwrap());
        assert_eq!(a.board.nodes, b.board.nodes);
        a.play().unwrap();
        b.play().unwrap();
        for _ in 0..30 {
            a.tick(0.17).unwrap();
            b.tick(0.17).unwrap();
            assert_eq!(a.checkpoint().unwrap(), b.checkpoint().unwrap());
            assert_eq!(a.board.nodes, b.board.nodes);
        }
        assert!(Session::restore(QUADRATIC, &saved).is_err());
        let mut invalid = saved.clone();
        invalid["cursor"] = json!(100000);
        assert!(Session::restore(CIRCLE, &invalid).is_err());
    }
}
#[test]
fn incremental_append_is_atomic_duplicate_safe_and_resumable() {
    let lines = CIRCLE.lines().collect::<Vec<_>>();
    let mut s = Session::load_incremental(lines[0], true).unwrap();
    s.play().unwrap();
    s.tick(100.).unwrap();
    assert!(s.waiting());
    assert!(!s.complete());
    let before = s.checkpoint().unwrap();
    assert!(s.append(lines[2]).is_err());
    assert_eq!(s.checkpoint().unwrap(), before);
    assert_eq!(s.append(lines[1]).unwrap(), 1);
    assert_eq!(s.append(lines[1]).unwrap(), 0);
    s.play().unwrap();
    s.tick(5.).unwrap();
    let current = s.board.nodes.clone();
    let animation = s.board.animation_state();
    s.append(lines[2]).unwrap();
    assert_eq!(s.board.nodes, current);
    assert_eq!(s.board.animation_state(), animation);
    s.play().unwrap();
    s.tick(1000.).unwrap();
    assert!(s.complete());
    let mut full = Session::load(CIRCLE).unwrap();
    full.play().unwrap();
    full.tick(1000.).unwrap();
    assert_eq!(s.board.nodes, full.board.nodes);
    assert_eq!(s.board.focus, full.board.focus);
    assert_eq!(s.append(lines[2]).unwrap(), 0);
}
