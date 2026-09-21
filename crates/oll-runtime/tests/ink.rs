use oll_runtime::{ink::Ink, spatial::Camera};
use serde_json::json;
#[test]
fn historical_samples_transform_once_cancel_and_undo_are_deterministic() {
    let mut ink = Ink::default();
    let camera = Camera {
        x: 10.,
        y: 20.,
        scale: 2.,
    };
    let sample = |x, t| json!({"x":x,"y":120.,"pressure":0.6,"time":t});
    ink.batch(
        &json!({"action":"down","pointerId":1,"points":[sample(110.,1)]}),
        camera,
        (20., 40.),
    )
    .unwrap();
    assert_eq!(ink.batch(&json!({"action":"up","pointerId":1,"points":[sample(110.,1),sample(130.,2),sample(150.,3)]}),Camera::default(),(0.,0.)).unwrap(),Some(1));
    assert_eq!(ink.strokes[0].points.len(), 3);
    assert_eq!(ink.strokes[0].points[0].x, 40.);
    assert_eq!(ink.strokes[0].points[0].y, 30.);
    let saved = ink.snapshot();
    ink.undo();
    assert!(ink.strokes.is_empty());
    ink.redo();
    assert_eq!(ink.snapshot(), saved);
    ink.batch(
        &json!({"action":"down","pointerId":2,"points":[sample(2.,4)]}),
        camera,
        (0., 0.),
    )
    .unwrap();
    ink.batch(&json!({"action":"cancel","pointerId":2}), camera, (0., 0.))
        .unwrap();
    assert_eq!(ink.snapshot(), saved);
    assert!(ink
        .batch(
            &json!({"action":"up","pointerId":2,"points":[]}),
            camera,
            (0., 0.)
        )
        .is_err());
}
