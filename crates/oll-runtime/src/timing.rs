//! Reading-budget and action delays from packages/web-runtime/src/runtime.ts.
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

pub fn narration_ms(text: &str, delivery: &str) -> f64 {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            r"[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]",
            r"[A-Za-z]+(?:['’-][A-Za-z]+)*",
            r"(?:[0-9]+(?:\.[0-9]+)?|[=+\-×÷√∠△π²³])",
            r"[,，、;；:：]",
            r"[.!?。！？]",
        ]
        .iter()
        .map(|s| Regex::new(s).expect("constant regex"))
        .collect()
    });
    let weights = [170, 300, 180, 100, 220];
    let sum: usize = patterns
        .iter()
        .zip(weights)
        .map(|(r, w)| r.find_iter(text).count() * w)
        .sum();
    let multiplier = match delivery {
        "careful" => 1.2,
        "patient" => 1.15,
        "emphatic" => 1.1,
        "encouraging" => 1.05,
        _ => 1.0,
    };
    ((700 + sum) as f64 * multiplier).clamp(1800.0, 45000.0)
}
fn content_length(v: &Value) -> usize {
    match v {
        Value::String(s) => s.chars().count(),
        Value::Number(n) => n.as_f64().map(|v| v.to_string().len()).unwrap_or(0),
        Value::Array(a) => a.iter().map(content_length).sum(),
        Value::Object(m) => m
            .iter()
            .filter(|(k, _)| *k != "id" && !k.ends_with("_id"))
            .map(|(_, v)| content_length(v))
            .sum(),
        _ => 0,
    }
}
pub fn operation_ms(op: &Value) -> f64 {
    match op["type"].as_str().unwrap_or("") {
        "action.apply" => {
            let a = &op["action"];
            match a["op"].as_str().unwrap_or("") {
                "board.create" => {
                    let n = content_length(&a["node"]["content"]) as f64;
                    match a["node"]["kind"].as_str().unwrap_or("") {
                        "math" => 1100.0 + (n * 55.0).min(2200.0),
                        "table" => 1600.0 + (n * 12.0).min(1800.0),
                        "diagram" | "plot" | "image" | "shape" => 1800.0,
                        "text" | "note" => 700.0 + (n * 28.0).min(1700.0),
                        _ => 1000.0 + (n * 20.0).min(1200.0),
                    }
                }
                "board.revise" => {
                    850.0 + (content_length(&a["revision"]["content"]) as f64 * 35.0).min(1800.0)
                }
                "board.focus" => 900.0,
                "board.group" => 850.0,
                "board.connect" => 700.0,
                "board.emphasize" => 650.0,
                "teacher.point" => 450.0,
                "teacher.expression" => 500.0,
                _ => 650.0,
            }
        }
        "narration.begin" => 180.0,
        "narration.end" => 160.0,
        "beat.end" => 700.0,
        "step.commit" => 1200.0,
        "step.begin" => 120.0,
        "beat.begin" => 100.0,
        "phase.begin" | "phase.end" => 50.0,
        _ => 100.0,
    }
}
