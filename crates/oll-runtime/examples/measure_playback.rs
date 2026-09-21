use oll_runtime::session::Session;
use std::time::Instant;
fn main() {
    let courses = [
        (
            "unit-circle-sine",
            include_str!("../../../examples/unit-circle-sine/lesson.canonical.jsonl"),
        ),
        (
            "quadratic",
            include_str!("../../../examples/quadratic/lesson.canonical.jsonl"),
        ),
        (
            "quadratic-v2",
            include_str!("../../../examples/quadratic-v2/lesson.canonical.jsonl"),
        ),
        (
            "english-relative-clause",
            include_str!("../../../examples/english-relative-clause/lesson.canonical.jsonl"),
        ),
    ];
    let mut results = vec![];
    for (name, source) in courses {
        let mut samples = vec![];
        let mut bytes = 0;
        let mut s = Session::load(source).unwrap();
        s.play().unwrap();
        for _ in 0..100000 {
            let start = Instant::now();
            s.tick(1. / 60.).unwrap();
            let encoded = s.projection().unwrap().to_string();
            samples.push(start.elapsed().as_secs_f64() * 1000.);
            bytes += encoded.len();
            if s.complete() {
                break;
            }
        }
        assert!(s.complete());
        samples.sort_by(f64::total_cmp);
        let n = samples.len();
        results.push(serde_json::json!({"course":name,"ticks":n,"tick_and_snapshot_ms_p50":samples[n/2],"tick_and_snapshot_ms_p95":samples[n*95/100],"tick_and_snapshot_ms_max":samples[n-1],"mean_snapshot_bytes":bytes/n}));
    }
    println!(
        "{}",
        serde_json::json!({"scope":"native core scheduling + full JSON projection; excludes GPU/audio/device latency","courses":results})
    );
}
