use oll_runtime::{connections::route, spatial::Rect};
use serde_json::Value;
fn rect(v: &Value) -> Rect {
    Rect {
        x: v["x"].as_f64().unwrap(),
        y: v["y"].as_f64().unwrap(),
        width: v["width"].as_f64().unwrap(),
        height: v["height"].as_f64().unwrap(),
    }
}
#[test]
fn routes_and_labels_match_web_obstacle_and_internal_cases() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/connections-reference.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let a = rect(&case["from"]);
        let b = rect(&case["to"]);
        let occupied = case["occupied"]
            .as_array()
            .unwrap()
            .iter()
            .map(rect)
            .collect::<Vec<_>>();
        let mut labels = vec![a, b];
        labels.extend(&occupied);
        let actual = route(
            a,
            b,
            case["label"].as_str().unwrap(),
            case["centers"].as_bool().unwrap(),
            &occupied,
            &mut labels,
        );
        let expected = &case["expected"];
        let points = expected["points"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(actual.points, points, "{case}");
        if expected["label"]["hidden"] == true {
            assert!(actual.label.is_none());
        } else {
            let l = actual.label.unwrap();
            let e = &expected["label"];
            assert_eq!(l.x + l.width / 2., e["x"].as_f64().unwrap());
            assert_eq!(l.y + 12., e["y"].as_f64().unwrap());
            assert_eq!(l.width, e["width"].as_f64().unwrap());
        }
    }
}
