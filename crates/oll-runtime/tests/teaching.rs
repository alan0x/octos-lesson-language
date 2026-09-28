//! Web parity for the stage rows teaching layout and the teaching camera.
//! Fixture: tools/teaching-reference.ts over the nine product course packs
//! (1440 wide and 700 narrow compositions) plus randomized camera cases.
use oll_runtime::{
    camera::{self, Insets, Mode},
    preview::Preview,
    spatial::{self, Camera, Rect},
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn rect(v: &Value) -> Rect {
    Rect {
        x: v["x"].as_f64().unwrap(),
        y: v["y"].as_f64().unwrap(),
        width: v["width"].as_f64().unwrap(),
        height: v["height"].as_f64().unwrap(),
    }
}
fn close(a: Rect, b: Rect, what: &str) {
    for (x, y) in [
        (a.x, b.x),
        (a.y, b.y),
        (a.width, b.width),
        (a.height, b.height),
    ] {
        assert!((x - y).abs() < 1e-6, "{what}: {a:?} != web {b:?}");
    }
}
fn reference() -> Value {
    serde_json::from_str(include_str!("fixtures/teaching-reference.json")).unwrap()
}

#[test]
fn stage_rows_layout_matches_web_at_every_action_of_every_course() {
    let r = reference();
    let mut frames_checked = 0;
    for course in r["courses"].as_array().unwrap() {
        let name = format!("{} @{}", course["pack"], course["composition"]["width"]);
        for frame in course["frames"].as_array().unwrap() {
            let Some(board) = frame.get("board") else {
                continue;
            };
            let nodes = board["nodes"].as_array().unwrap().clone();
            let p = Preview::from_board(
                nodes.clone(),
                board["groups"].as_array().unwrap().clone(),
                board["connections"].as_array().unwrap().clone(),
            );
            let sizes: BTreeMap<String, (f64, f64)> = frame["sizes"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(id, s)| {
                    (
                        id.clone(),
                        (s["width"].as_f64().unwrap(), s["height"].as_f64().unwrap()),
                    )
                })
                .collect();
            let region = nodes[0]["region_id"].as_str().unwrap_or("__legacy__");
            let constraint = json!({
                "x": 20, "y": 20, "flow": "teaching",
                "nodeSections": course["nodeSections"], "plannedSteps": course["plannedSteps"],
                "composition": course["composition"], "reservedWidth": 1300,
                "attachments": frame["attachments"],
            });
            let options = json!({"regions": {region: constraint}});
            let actual = spatial::layout_with_options(&p, &sizes, &options).unwrap();
            let at = format!("{name} {}", frame["action_id"]);
            let web = &frame["layout"];
            assert_eq!(
                actual.nodes.len(),
                web["nodes"].as_object().unwrap().len(),
                "{at}: node count"
            );
            for (id, r) in &actual.nodes {
                close(*r, rect(&web["nodes"][id]), &format!("{at} node {id}"));
            }
            assert_eq!(
                actual.attachments.len(),
                web["attachments"].as_object().unwrap().len(),
                "{at}: attachment count"
            );
            for (id, r) in &actual.attachments {
                close(
                    *r,
                    rect(&web["attachments"][id]),
                    &format!("{at} attachment {id}"),
                );
            }
            frames_checked += 1;
        }
    }
    assert!(frames_checked > 300, "only {frames_checked} frames");
}

#[test]
fn focus_camera_matches_web_plan_focus_camera() {
    let r = reference();
    for (i, case) in r["cameras"].as_array().unwrap().iter().enumerate() {
        let targets: Vec<Rect> = case["targets"]
            .as_array()
            .unwrap()
            .iter()
            .map(rect)
            .collect();
        let c = &case["current"];
        let current = Camera {
            x: c["panX"].as_f64().unwrap(),
            y: c["panY"].as_f64().unwrap(),
            scale: c["scale"].as_f64().unwrap(),
        };
        let i_ = &case["insets"];
        let insets = Insets {
            top: i_["top"].as_f64().unwrap(),
            right: i_["right"].as_f64().unwrap(),
            bottom: i_["bottom"].as_f64().unwrap(),
            left: i_["left"].as_f64().unwrap(),
            focus_margin: i_["focusMargin"].as_f64(),
            occlusions: i_["occlusions"]
                .as_array()
                .unwrap()
                .iter()
                .map(rect)
                .collect(),
        };
        let mode = match case["mode"].as_str().unwrap() {
            "relationship" => Mode::Relationship,
            "overview" => Mode::Overview,
            "course" => Mode::Course,
            _ => Mode::Detail,
        };
        let v = &case["viewport"];
        let got = camera::plan_focus(
            &targets,
            current,
            v["width"].as_f64().unwrap(),
            v["height"].as_f64().unwrap(),
            mode,
            &insets,
            case["floor"].as_f64().unwrap(),
        );
        let w = &case["result"];
        for (a, b) in [
            (got.x, w["panX"].as_f64().unwrap()),
            (got.y, w["panY"].as_f64().unwrap()),
            (got.scale, w["scale"].as_f64().unwrap()),
        ] {
            assert!((a - b).abs() < 1e-6, "camera case {i}: {got:?} != web {w}");
        }
    }
}
