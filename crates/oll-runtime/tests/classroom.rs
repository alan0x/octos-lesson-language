//! Live classroom parity with the web workspace: generated lessons
//! materialized with loadOllLessonArtifact host ids and composed with
//! composeOllClassroomEvents (fixtures/classroom/expected.json is the web
//! output for a.authoring.json, b.authoring.json and c.authoring.json).
use oll_runtime::{authoring, classroom};
use serde_json::Value;
use std::path::Path;

#[test]
fn composed_classroom_matches_the_web() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/classroom");
    let expected: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
    let session = expected["sessionId"].as_str().unwrap();
    let mut per = Vec::new();
    for (i, name) in ["a", "b", "c"].iter().enumerate() {
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{name}.authoring.json"))).unwrap()).unwrap();
        let turn = expected["turns"][i].as_str().unwrap();
        let events = authoring::materialize(&doc, &classroom::live_host(session, turn, &doc)).unwrap();
        let want = expected["per"][i].as_array().unwrap();
        assert_eq!(events.len(), want.len(), "{name}: event count");
        for (j, (g, w)) in events.iter().zip(want).enumerate() {
            assert_eq!(g, w, "{name}: event {j}");
        }
        per.push(events);
    }
    let composed = classroom::compose(&per, session);
    let want = expected["composed"].as_array().unwrap();
    assert_eq!(composed.len(), want.len(), "composed event count");
    for (j, (g, w)) in composed.iter().zip(want).enumerate() {
        assert_eq!(g, w, "composed event {j}");
    }
    // The classroom plays as one incremental program.
    oll_runtime::session::Session::load_incremental(&classroom::to_jsonl(&composed), true).unwrap();
}
