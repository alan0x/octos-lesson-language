use oll_runtime::expression::{evaluate, Variables};
#[test]
fn precedence_and_normalization() {
    let vars = Variables::from([("theta".into(), std::f64::consts::FRAC_PI_2)]);
    for (s, expected) in [
        ("-2^2", -4.0),
        ("2^-2", 0.25),
        ("2^3^2", 512.0),
        ("sin(theta)", 1.0),
        ("cos(π) × 2 − 4 ÷ 2", -4.0),
        ("1e-3 + .5", 0.501),
        ("round(-1.5)", -1.0),
    ] {
        assert!(
            (evaluate(s, &vars).unwrap() - expected).abs() < 1e-12,
            "{s}"
        );
    }
    assert!(evaluate("round(-.5)", &vars).unwrap().is_sign_negative());
}
#[test]
fn rejects_invalid_or_non_finite_results() {
    for s in [
        "",
        "x",
        "1/0",
        "sqrt(-1)",
        "sin(1",
        "2 3",
        "1e",
        "process()",
        "2**3",
        ".",
    ] {
        assert!(evaluate(s, &Variables::new()).is_err(), "{s}");
    }
    assert!(evaluate(&"1".repeat(257), &Variables::new()).is_err());
}
