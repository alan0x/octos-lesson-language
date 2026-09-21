use oll_runtime::preview::Preview;
const SOURCE: &str = include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl");
#[test]
fn real_course_animation_and_bound_values() {
    let mut p = Preview::load(SOURCE).unwrap();
    assert_eq!(p.action_count(), 5);
    for _ in 0..4 {
        p.advance().unwrap();
    }
    assert_eq!(p.nodes.len(), 2);
    assert_eq!(p.connections.len(), 1);
    p.tick(1.35).unwrap();
    assert!((p.variables["theta"] - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    assert!((p.nodes[0]["content"]["points"][1]["y"].as_f64().unwrap() - 1.0).abs() < 1e-12);
    assert!((p.nodes[1]["content"]["points"][5]["y"].as_f64().unwrap() - 1.0).abs() < 1e-12);
    assert!(p.advance().is_err());
    let frozen = p.variables.clone();
    p.tick(0.0).unwrap();
    assert_eq!(p.variables, frozen);
    p.tick(4.05).unwrap();
    p.advance().unwrap();
    assert!(p.complete());
    assert_eq!(p.focus.len(), 2);
}
#[test]
fn rejects_invalid_program_and_preserves_state_on_bad_variable() {
    assert!(Preview::load(&SOURCE.replace("board.connect", "unknown.op")).is_err());
    assert!(Preview::load(&SOURCE.replace("\"sequence\":1", "\"sequence\":9")).is_err());
    let mut p = Preview::load(SOURCE).unwrap();
    p.advance().unwrap();
    let nodes = p.nodes.clone();
    assert!(p.set_variable("theta", 100.0).is_err());
    assert_eq!(p.nodes, nodes);
}
const RECTANGLE_AREA: &str =
    include_str!("../../../examples/rectangle-area-from-tiles/lesson.canonical.jsonl");
const SLOPE_INTERCEPT: &str =
    include_str!("../../../examples/slope-and-intercept/lesson.canonical.jsonl");
#[test]
fn embedded_courses_play_to_completion_and_record_teacher_expression() {
    for source in [RECTANGLE_AREA, SLOPE_INTERCEPT] {
        let mut p = Preview::load(source).unwrap();
        assert_eq!(p.action_count(), 19);
        while !p.complete() {
            p.advance().unwrap_or_else(|e| panic!("advance failed: {e}"));
            p.tick(1000.0).unwrap();
        }
        assert_eq!(p.cursor, p.action_count());
        assert_eq!(p.last_expression.as_deref(), Some("neutral"));
        assert_eq!(p.nodes.len(), 5);
    }
}
#[test]
fn teacher_expression_requires_value() {
    let broken = RECTANGLE_AREA.replace(
        "\"op\":\"teacher.expression\",\"expression\":\"neutral\"",
        "\"op\":\"teacher.expression\",\"expression\":\"\"",
    );
    assert!(Preview::load(&broken).is_err());
}
