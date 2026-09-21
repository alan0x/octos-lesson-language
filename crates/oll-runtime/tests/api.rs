use oll_runtime::{api::RuntimeApi, checkpoint};
use serde_json::{json, Value};
#[test]
fn shared_api_projection_matches_legacy_checkpoints_and_reports_errors() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/checkpoints-reference.json")).unwrap();
    let mut api = RuntimeApi::default();
    assert_eq!(api.request(&json!({"command":"play"}))["ok"], false);
    for c in fixture["courses"].as_array().unwrap() {
        let source = if c["course"] == "quadratic" {
            include_str!("../../../examples/quadratic/lesson.canonical.jsonl")
        } else {
            include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl")
        };
        for saved in c["checkpoints"].as_array().unwrap() {
            let reply =
                api.request(&json!({"command":"restore","source":source,"checkpoint":saved}));
            assert_eq!(reply["ok"], true, "{reply}");
            assert!(
                checkpoint::equivalent(&reply["result"]["projection"], &saved["projection"]),
                "cursor {}",
                saved["cursor"]
            );
        }
    }
    let before = api.request(&json!({"command":"snapshot"}));
    assert_eq!(
        api.request(&json!({"command":"load","source":"garbage"}))["ok"],
        false
    );
    assert_eq!(api.request(&json!({"command":"snapshot"})), before);
    assert_eq!(
        api.request(&json!({"command":"tick","seconds":-1}))["ok"],
        false
    );
}
