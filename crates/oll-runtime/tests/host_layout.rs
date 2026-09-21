use oll_runtime::{preview::Preview, spatial};
use serde_json::Value;
#[test]
fn host_regions_reading_lanes_obstacles_attachments_and_visual_order_match_web() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/host-layout-reference.json")).unwrap();
    for (i, c) in cases.as_array().unwrap().iter().enumerate() {
        let mut p = Preview::load(include_str!(
            "../../../examples/unit-circle-sine/lesson.canonical.jsonl"
        ))
        .unwrap();
        p.nodes = c["state"]["nodes"]
            .as_object()
            .unwrap()
            .values()
            .cloned()
            .collect();
        p.groups = c["state"]["groups"]
            .as_object()
            .unwrap()
            .values()
            .cloned()
            .collect();
        p.connections = c["state"]["connections"]
            .as_object()
            .unwrap()
            .values()
            .cloned()
            .collect();
        let sizes = c["sizes"]
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
        let actual = spatial::layout_with_options(&p, &sizes, &c["options"]).unwrap();
        for (key, rs) in [
            ("nodes", actual.nodes),
            ("groups", actual.groups),
            ("attachments", actual.attachments),
            ("regions", actual.regions),
        ] {
            assert_eq!(rs.len(), c["expected"][key].as_object().unwrap().len());
            for (id, r) in rs {
                let e = &c["expected"][key][&id];
                for (k, n) in [
                    ("x", r.x),
                    ("y", r.y),
                    ("width", r.width),
                    ("height", r.height),
                ] {
                    assert!(
                        (n - e[k].as_f64().unwrap()).abs() < 1e-8,
                        "case {i} {key}.{id}.{k}: got {n} expected {}",
                        e[k]
                    );
                }
            }
        }
    }
}
