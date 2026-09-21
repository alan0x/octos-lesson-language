use oll_runtime::{
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
fn check(a: Rect, b: Rect) {
    for (x, y) in [
        (a.x, b.x),
        (a.y, b.y),
        (a.width, b.width),
        (a.height, b.height),
    ] {
        assert!((x - y).abs() < 1e-8, "{a:?} != {b:?}");
    }
}
#[test]
fn course_layouts_match_existing_web_for_every_action() {
    let r: Value = serde_json::from_str(include_str!("fixtures/spatial-reference.json")).unwrap();
    for course in r["courses"].as_array().unwrap() {
        let source = if course["course"] == "quadratic" {
            include_str!("../../../examples/quadratic/lesson.canonical.jsonl")
        } else {
            include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl")
        };
        let mut p = Preview::load(source).unwrap();
        for frame in course["frames"].as_array().unwrap() {
            p.advance().unwrap();
            p.tick(1000.).unwrap();
            let sizes = frame["sizes"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(id, v)| {
                    (
                        id.clone(),
                        (v["width"].as_f64().unwrap(), v["height"].as_f64().unwrap()),
                    )
                })
                .collect();
            let actual = spatial::layout(&p, &sizes).unwrap();
            for (map, key) in [(&actual.nodes, "nodes"), (&actual.groups, "groups")] {
                assert_eq!(map.len(), frame["layout"][key].as_object().unwrap().len());
                for (id, r) in map {
                    check(*r, rect(&frame["layout"][key][id]));
                }
            }
            check(actual.bounds, rect(&frame["layout"]["bounds"]));
        }
    }
}
#[test]
fn focus_camera_matches_web_and_zoom_keeps_pointer_anchor() {
    let r: Value = serde_json::from_str(include_str!("fixtures/spatial-reference.json")).unwrap();
    for c in r["cameras"].as_array().unwrap() {
        let targets = c["targets"]
            .as_array()
            .unwrap()
            .iter()
            .map(rect)
            .collect::<Vec<_>>();
        let camera = spatial::focus_camera(
            &targets,
            Camera::default(),
            c["viewport"]["width"].as_f64().unwrap(),
            c["viewport"]["height"].as_f64().unwrap(),
            c["mode"].as_str().unwrap(),
        );
        for (a, key) in [
            (camera.x, "panX"),
            (camera.y, "panY"),
            (camera.scale, "scale"),
        ] {
            assert!((a - c["expected"][key].as_f64().unwrap()).abs() < 1e-8);
        }
        let at = camera.view_to_world(315., 203.);
        let zoom = camera.zoom_at(1.25, 315., 203.);
        let mapped = zoom.world_to_view(at.0, at.1);
        assert!((mapped.0 - 315.).abs() < 1e-8 && (mapped.1 - 203.).abs() < 1e-8);
        assert_eq!(camera.interpolate(zoom, 0.), camera);
        assert_eq!(camera.interpolate(zoom, 1.), zoom);
    }
}
#[test]
fn relative_placement_alignment_and_explicit_overlay() {
    let mut p = Preview::load(include_str!(
        "../../../examples/quadratic/lesson.canonical.jsonl"
    ))
    .unwrap();
    p.nodes = vec![
        json!({"id":"a","placement":{"relation":"new_region"}}),
        json!({"id":"b","placement":{"relation":"below","anchor":"a","align":"end","gap":"compact"}}),
        json!({"id":"c","placement":{"relation":"overlay","anchor":"a"}}),
    ];
    let sizes = BTreeMap::from([
        ("a".into(), (300., 120.)),
        ("b".into(), (100., 60.)),
        ("c".into(), (80., 40.)),
    ]);
    let l = spatial::layout(&p, &sizes).unwrap();
    assert_eq!(l.nodes["b"].x, l.nodes["a"].x + 200.);
    assert_eq!(l.nodes["b"].y, l.nodes["a"].y + 148.);
    assert_eq!(l.nodes["c"].x, l.nodes["a"].x + 24.);
    p.nodes[1]["placement"]["anchor"] = "missing".into();
    assert!(spatial::layout(&p, &sizes).is_err());
}
