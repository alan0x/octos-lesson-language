//! Web parity for the stage rows teaching layout and the teaching camera.
//! Fixture: tools/teaching-reference.ts over the nine product course packs
//! (1440 and 700 wide desktop compositions, 1920 meeting display at reading
//! scale .68) plus randomized camera and frame-hold cases.
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

fn camera_of(c: &Value) -> Camera {
    Camera {
        x: c["panX"].as_f64().unwrap(),
        y: c["panY"].as_f64().unwrap(),
        scale: c["scale"].as_f64().unwrap(),
    }
}
fn insets_of(i: &Value) -> Insets {
    Insets {
        top: i["top"].as_f64().unwrap(),
        right: i["right"].as_f64().unwrap(),
        bottom: i["bottom"].as_f64().unwrap(),
        left: i["left"].as_f64().unwrap(),
        focus_margin: i["focusMargin"].as_f64(),
        occlusions: i["occlusions"].as_array().unwrap().iter().map(rect).collect(),
    }
}
fn rects(v: &Value) -> Vec<Rect> {
    v.as_array().unwrap().iter().map(rect).collect()
}

#[test]
fn focus_camera_matches_web_plan_focus_camera() {
    let r = reference();
    for (i, case) in r["cameras"].as_array().unwrap().iter().enumerate() {
        let targets = rects(&case["targets"]);
        let parts = case.get("parts").filter(|p| p.is_array()).map(rects);
        let mode = match case["mode"].as_str().unwrap() {
            "relationship" => Mode::Relationship,
            "overview" => Mode::Overview,
            "course" => Mode::Course,
            _ => Mode::Detail,
        };
        let v = &case["viewport"];
        let got = camera::plan_focus(
            &targets,
            camera_of(&case["current"]),
            v["width"].as_f64().unwrap(),
            v["height"].as_f64().unwrap(),
            mode,
            &insets_of(&case["insets"]),
            case["floor"].as_f64().unwrap(),
            case["ceiling"].as_f64().unwrap(),
            parts.as_deref(),
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

#[test]
fn teaching_frame_hold_matches_web() {
    let r = reference();
    let cases = r["holds"].as_array().unwrap();
    let held = cases.iter().filter(|c| c["result"] == true).count();
    assert!(held > 0 && held < cases.len());
    for (i, case) in cases.iter().enumerate() {
        let v = &case["viewport"];
        let got = camera::holds_teaching_frame(
            &rects(&case["targets"]),
            camera_of(&case["current"]),
            camera_of(&case["planned"]),
            v["width"].as_f64().unwrap(),
            v["height"].as_f64().unwrap(),
            &insets_of(&case["insets"]),
            case["centerShare"].as_f64().unwrap_or(f64::INFINITY),
            case["readable"].as_f64().unwrap_or(f64::INFINITY),
        );
        assert_eq!(got, case["result"].as_bool().unwrap(), "hold case {i}");
    }
}

#[test]
fn control_panels_cluster_like_the_web_host() {
    let r = reference();
    let mut checked = 0;
    for course in r["courses"].as_array().unwrap() {
        let course_nodes: Vec<String> = course["nodeSections"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        let declarations = course["variables"].as_array().unwrap();
        for frame in course["frames"].as_array().unwrap() {
            let Some(board) = frame.get("board") else {
                continue;
            };

            let mut nodes = board["nodes"].as_array().unwrap().clone();
            for n in &mut nodes {
                let content = course["visualContent"][n["id"].as_str().unwrap()].clone();
                if !content.is_null() {
                    n["content"] = content;
                }
            }
            let region = nodes[0]["region_id"]
                .as_str()
                .unwrap_or("__legacy__")
                .to_owned();
            let p = Preview::from_board(nodes, vec![], vec![]);
            // Host: every cluster's controls, then (after the lesson) its practice panel.
            let practice = frame["action_id"] == "practice";
            let got: Vec<oll_runtime::teaching::Attachment> = oll_runtime::teaching::interaction_clusters(
                &p,
                &region,
                &course_nodes,
                declarations,
                course["tasks"].as_array().unwrap(),
            )
            .iter()
            .flat_map(|c| {
                let mut out = Vec::new();
                if !c.sliders.is_empty() {
                    out.push(c.controls_attachment());
                }
                if practice && !c.task_ids.is_empty() {
                    out.push(c.tasks_attachment(c.task_ids.len(), None));
                }
                out
            })
            .collect();
            let web: Vec<oll_runtime::teaching::Attachment> = frame["attachments"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|a| a["kind"] != "reflection")
                .map(|a| oll_runtime::teaching::Attachment::from_json(a).unwrap())
                .collect();
            assert_eq!(got, web, "{} {}", course["pack"], frame["action_id"]);
            checked += 1;
        }
    }
    assert!(checked > 300);
}
