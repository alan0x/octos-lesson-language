use std::io::{self, BufRead};
fn main() {
    let mut api = oll_runtime::api::RuntimeApi::default();
    for line in io::stdin().lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str(&line) {
                Ok(value) => api.request(&value),
                Err(e) => serde_json::json!({"ok":false,"error":e.to_string()}),
            },
            Err(e) => {
                eprintln!("{e}");
                break;
            }
        };
        println!("{response}");
    }
}
