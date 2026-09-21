//! Versioned host boundary used by native tests and the raw WebAssembly adapter.
use crate::session::Session;
use serde_json::{json, Value};
#[derive(Default)]
pub struct RuntimeApi {
    session: Option<Session>,
}
impl RuntimeApi {
    pub fn request(&mut self, request: &Value) -> Value {
        match self.execute(request) {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        }
    }
    fn execute(&mut self, r: &Value) -> Result<Value, String> {
        let command = r["command"].as_str().ok_or("Missing command")?;
        if command == "load" {
            let source = r["source"].as_str().ok_or("Missing course source")?;
            let session =
                Session::load_incremental(source, r["incremental"].as_bool().unwrap_or(false))?;
            self.session = Some(session);
        } else if command == "restore" {
            let source = r["source"].as_str().ok_or("Missing course source")?;
            self.session = Some(Session::restore(source, &r["checkpoint"])?);
        }
        let session = self.session.as_mut().ok_or("No course loaded")?;
        match command {
            "load" | "restore" | "snapshot" => (),
            "play" => session.play()?,
            "pause" => session.pause(),
            "tick" => session.tick(r["seconds"].as_f64().ok_or("Missing elapsed seconds")?)?,
            "append" => {
                session.append(r["source"].as_str().ok_or("Missing appended source")?)?;
            }
            "checkpoint" => return session.checkpoint(),
            _ => return Err(format!("Unknown command {command}")),
        }
        Ok(
            json!({"projection":session.projection()?,"operation":session.operations.get(session.cursor.saturating_sub(1)).filter(|_|session.cursor>0),"animation":session.board.animation_state(),"narration":session.board.narration,"action_cursor":session.board.cursor,"action_count":session.board.action_count()}),
        )
    }
}
