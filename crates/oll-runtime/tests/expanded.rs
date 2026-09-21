use oll_runtime::{checkpoint::equivalent, session::Session};
use serde_json::Value;
#[test]
fn expanded_real_courses_match_every_web_action_and_restore_final_progress() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/expanded-reference.json")).unwrap();
    for c in cases.as_array().unwrap() {
        let source = if c["course"] == "quadratic-v2" {
            include_str!("../../../examples/quadratic-v2/lesson.canonical.jsonl")
        } else {
            include_str!("../../../examples/english-relative-clause/lesson.canonical.jsonl")
        };
        let mut p = Session::load(source).unwrap();
        p.play().unwrap();
        let mut index = 0;
        for _ in 0..100000 {
            if p.board.cursor > index {
                let expected = &c["frames"][index]["board"];
                for (key, objects) in [
                    ("nodes", &p.board.nodes),
                    ("connections", &p.board.connections),
                    ("groups", &p.board.groups),
                ] {
                    let actual = Value::Object(
                        objects
                            .iter()
                            .map(|n| (n["id"].as_str().unwrap().to_owned(), n.clone()))
                            .collect(),
                    );
                    assert!(
                        equivalent(&actual, &expected[key]),
                        "{} {key} action {}",
                        c["course"],
                        index + 1
                    );
                }
                index += 1;
            }
            if p.complete() {
                break;
            }
            p.tick(0.02).unwrap();
        }
        assert!(p.complete());
        assert_eq!(index, c["frames"].as_array().unwrap().len());
        let restored = Session::restore(source, &c["checkpoint"]).unwrap();
        assert!(equivalent(
            &restored.projection().unwrap(),
            &c["checkpoint"]["projection"]
        ));
    }
}
