//! JavaScript JSON.stringify compatibility for legacy course fingerprints.
use serde_json::Value;
fn number(n: f64) -> String {
    if n == 0. {
        return "0".into();
    }
    let negative = n < 0.;
    let raw = n.abs().to_string();
    let (mantissa, exponent) = raw
        .split_once('e')
        .map(|(m, e)| (m, e.parse::<i32>().unwrap()))
        .unwrap_or((&raw, 0));
    let dot = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits = mantissa.replace('.', "");
    let leading = digits.len() - digits.trim_start_matches('0').len();
    digits.drain(..leading);
    let decimal = dot + exponent - leading as i32;
    while digits.ends_with('0') && digits.len() > 1 {
        digits.pop();
    }
    let mut out = String::new();
    if negative {
        out.push('-')
    }
    if decimal > 0 && decimal <= 21 {
        if decimal as usize >= digits.len() {
            out.push_str(&digits);
            out.push_str(&"0".repeat(decimal as usize - digits.len()));
        } else {
            out.push_str(&digits[..decimal as usize]);
            out.push('.');
            out.push_str(&digits[decimal as usize..]);
        }
    } else if decimal <= 0 && decimal > -6 {
        out.push_str("0.");
        out.push_str(&"0".repeat((-decimal) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if digits.len() > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let e = decimal - 1;
        if e >= 0 {
            out.push('+')
        }
        out.push_str(&e.to_string());
    }
    out
}
fn array_index(k: &str) -> Option<u32> {
    let n = k.parse::<u32>().ok()?;
    if n == u32::MAX || n.to_string() != k {
        None
    } else {
        Some(n)
    }
}
pub fn stringify(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number(n.as_f64().unwrap()),
        Value::String(s) => serde_json::to_string(s).unwrap(),
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(stringify).collect::<Vec<_>>().join(",")
        ),
        Value::Object(o) => {
            let mut keys = o.keys().collect::<Vec<_>>();
            keys.sort_by_key(|k| array_index(k).map(|i| (0, i)).unwrap_or((1, 0)));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), stringify(&o[k])))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}
pub fn fingerprint(events: &Value) -> String {
    let mut hash = 0x811c9dc5_u32;
    for unit in stringify(events).encode_utf16() {
        hash = (hash ^ unit as u32).wrapping_mul(0x01000193);
    }
    format!("fnv1a32:{hash:08x}")
}

/// Compare JSON semantics across JS integer/float encodings and native libm rounding.
pub fn equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let x = a.as_f64().unwrap();
            let y = b.as_f64().unwrap();
            (x - y).abs() <= 1e-12 * x.abs().max(y.abs()).max(1.)
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equivalent(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|b| equivalent(v, b)))
        }
        _ => a == b,
    }
}
