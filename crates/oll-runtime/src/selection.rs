//! Questions about an ink selection (web octos-learn selection-tools.ts,
//! selection-enhancements.ts and web-runtime board-targets.ts): the tool
//! registry, which answers become lessons, the board content a selection
//! covers, the lesson request text and the source checksum.
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// Web SelectionContentKind.
pub const CONTENT_KINDS: [(&str, &str); 5] =
    [("unknown", "暂不确定"), ("text", "文字"), ("math", "公式"), ("geometry", "图形"), ("data", "数据")];

pub struct Tool {
    pub id: &'static str,
    pub label: &'static str,
    pub prompt: &'static str,
    pub content_kinds: &'static [&'static str],
    pub request_content_kind: Option<&'static str>,
}

/// Web selectionToolRegistry.
pub const TOOLS: [Tool; 3] = [
    Tool {
        id: "explain",
        label: "解释这部分",
        prompt: "请结合这部分内容给我上一节课。请先判断它是公式、题目、解题过程还是其他学习内容，再围绕其含义、关键知识和解题或应用方法进行讲解，目标是让我理解并会用。",
        content_kinds: &["text", "math", "geometry", "data", "unknown"],
        request_content_kind: None,
    },
    Tool {
        id: "check-and-suggest",
        label: "检查并建议",
        prompt: "请检查我选中的内容，并在旁边给出建议。",
        content_kinds: &["text", "math", "geometry", "data", "unknown"],
        request_content_kind: None,
    },
    Tool {
        id: "generate-plot",
        label: "生成函数图像",
        prompt: "请按我选中的公式生成函数图像。",
        content_kinds: &["math"],
        request_content_kind: Some("math"),
    },
];

/// Web availableSelectionTools (node-level targets only).
pub fn available_tools(content_kind: &str) -> Vec<&'static Tool> {
    TOOLS.iter().filter(|t| t.content_kinds.contains(&content_kind)).collect()
}

fn normalize_request(request: &str) -> String {
    // NFKC for the characters that matter here: full-width ASCII.
    let folded: String = request
        .chars()
        .map(|c| match c as u32 {
            0xff01..=0xff5e => char::from_u32(c as u32 - 0xfee0).unwrap_or(c),
            0x3000 => ' ',
            _ => c,
        })
        .collect::<String>()
        .to_lowercase()
        .replace('課', "课")
        .replace("課程", "课程");
    static STRIP: OnceLock<Regex> = OnceLock::new();
    STRIP
        .get_or_init(|| Regex::new(r#"[\s，。！？、；：,.!?;:"'“”‘’（）()【】\[\]…—–-]+"#).unwrap())
        .replace_all(&folded, "")
        .into_owned()
}

/// Web isSelectionLessonRequest.
pub fn is_lesson_request(request: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(?:(?:讲|上|来|开始|安排|准备|生成|创建|设计).{0,8}(?:一|这|本|个)?(?:节|堂|门)?课程?|(?:做|变|整理|扩展)成.{0,8}(?:一|这|本|个)?(?:节|堂|门)?课程?|(?:系统|完整|从头|一步一步)(?:地)?(?:讲解|讲|教)|(?:teach|create|make).{0,16}(?:lesson|course))").unwrap()
    })
    .is_match(&normalize_request(request))
}

/// Web selectionAnswerPresentation: "lesson" | "card" | "board-writing".
pub fn answer_presentation(tool_id: &str, request: &str, board_writing: bool) -> &'static str {
    if tool_id == "explain" {
        return "lesson";
    }
    if !board_writing {
        return "card";
    }
    if tool_id == "check-and-suggest" {
        return "board-writing";
    }
    if tool_id == "generate-plot" {
        return "card";
    }
    static FORM: OnceLock<Regex> = OnceLock::new();
    static EDIT: OnceLock<Regex> = OnceLock::new();
    static VISUAL: OnceLock<Regex> = OnceLock::new();
    let request = request.trim();
    if FORM.get_or_init(|| Regex::new(r"(?i)(改|更改|修改|整理|转换|转成|变成|写成).{0,24}(形式|表达式|方程|可绘|可以绘)").unwrap()).is_match(request) {
        return "board-writing";
    }
    if VISUAL.get_or_init(|| Regex::new(r"(?i)(画|绘制|生成|展示|显示).{0,12}(图|图像|曲线|曲面)|(plot|graph|visuali[sz]e)").unwrap()).is_match(request) {
        return "card";
    }
    if EDIT
        .get_or_init(|| Regex::new(r"(?i)(检查|建议|批改|纠错|纠正|改写|修改|更改|整理|转换|转写|誊写|抄写|板书|写在.{0,8}(白板|旁边)|check|correct|rewrite|transcribe)").unwrap())
        .is_match(request)
    {
        "board-writing"
    } else {
        "card"
    }
}

/// Web compactValue: the listed fields that are present, or nothing.
fn compact_value(content: &Value, keys: &[&str]) -> Option<Value> {
    let picked: Map<String, Value> = keys
        .iter()
        .filter_map(|k| content.get(*k).filter(|v| !v.is_null()).map(|v| ((*k).to_owned(), v.clone())))
        .collect();
    (!picked.is_empty()).then_some(Value::Object(picked))
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// Web describeBoardTarget + targetQueryScore + rankBoardTargets for whole
/// cards: `rects` are (node id, x, y, w, h, z) in world units.
pub fn node_candidates(nodes: &[Value], rects: &[(String, f64, f64, f64, f64, usize)], bounds: (f64, f64, f64, f64)) -> Vec<Value> {
    let (qx, qy, qw, qh) = bounds;
    let mut out = Vec::new();
    for (id, x, y, w, h, z) in rects {
        let Some(node) = nodes.iter().find(|n| n["id"] == id.as_str()) else { continue };
        let ix = x.max(qx);
        let iy = y.max(qy);
        let iw = (x + w).min(qx + qw) - ix;
        let ih = (y + h).min(qy + qh) - iy;
        if iw <= 0. || ih <= 0. {
            continue;
        }
        let overlap = (iw * ih / (w * h).max(1.)).min(1.);
        let distance = ((x + w / 2.) - (qx + qw / 2.)).hypot((y + h / 2.) - (qy + qh / 2.));
        let content = &node["content"];
        let label = text(&content["title"]).or_else(|| text(&content["label"])).unwrap_or_else(|| node["kind"].as_str().unwrap_or("text").to_owned());
        let mut candidate = json!({
            "target_id": id,
            "node_id": id,
            "kind": "node",
            "label": label,
            "world_bounds": {"x": x, "y": y, "width": w, "height": h},
            "overlap": overlap,
            "distance": distance,
            "z_index": z,
        });
        if let Some(v) = compact_value(content, &["text", "latex", "expression", "caption"]) {
            candidate["value"] = v;
        }
        out.push(candidate);
    }
    out.sort_by(|a, b| {
        let f = |v: &Value, k: &str| v[k].as_f64().unwrap_or(0.);
        let area = |v: &Value| f(&v["world_bounds"], "width") * f(&v["world_bounds"], "height");
        f(b, "overlap")
            .total_cmp(&f(a, "overlap"))
            .then(f(a, "distance").total_cmp(&f(b, "distance")))
            .then(area(a).total_cmp(&area(b)))
            .then(f(b, "z_index").total_cmp(&f(a, "z_index")))
            .then(a["target_id"].as_str().cmp(&b["target_id"].as_str()))
    });
    out.truncate(12);
    out
}

/// Web formatSelectionLessonRequest.
pub fn format_lesson_request(base: &str, targets: &[Value], recognized: Option<&str>) -> String {
    let trimmed = base.trim();
    let mut descriptions: Vec<String> = Vec::new();
    for target in targets.iter().filter(|t| text(&t["label"]).is_some() || !t["value"].is_null()) {
        let label = text(&target["label"]);
        let value = &target["value"];
        let detail = if value.is_object() {
            ["latex", "text", "expression", "caption"]
                .iter()
                .find_map(|k| value.get(*k).filter(|v| !v.is_null()))
                .and_then(text)
                .filter(|d| Some(d) != label.as_ref())
        } else {
            text(value).filter(|d| Some(d) != label.as_ref())
        };
        let description = match (label, detail) {
            (Some(l), Some(d)) => format!("{l}（{d}）"),
            (Some(l), None) => l,
            (None, Some(d)) => d,
            (None, None) => continue,
        };
        if !descriptions.contains(&description) {
            descriptions.push(description);
        }
    }
    let mut details = Vec::new();
    if !descriptions.is_empty() {
        details.push(format!("选中的白板内容【{}】", descriptions.join("，")));
    }
    if let Some(r) = recognized.map(str::trim).filter(|r| !r.is_empty()) {
        details.push(format!("识别出的内容【{r}】"));
    }
    if details.is_empty() {
        return trimmed.to_owned();
    }
    let joined = details.join("及");
    match trimmed.strip_prefix("请结合这部分内容") {
        Some(rest) => format!("请结合我{joined}{rest}"),
        None => format!("请结合我{joined}：{trimmed}"),
    }
}

/// SHA-256 (FIPS 180-4) as lowercase hex: the selection source checksum
/// the learning-coach requires.
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
        0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
        0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [t1.wrapping_add(t2), v[0], v[1], v[2], v[3].wrapping_add(t1), v[4], v[5], v[6]];
        }
        for (a, b) in h.iter_mut().zip(v) {
            *a = a.wrapping_add(b);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// Web selectionSourceArgument for the skill: identity, bounds, checksum.
pub fn source_argument(source_id: &str, document_id: &str, version: u64, bounds: (f64, f64, f64, f64), strokes: &Value) -> Value {
    json!({
        "source_id": source_id,
        "document_id": document_id,
        "document_version": version,
        "bounds": {"x": bounds.0, "y": bounds.1, "width": bounds.2, "height": bounds.3},
        "checksum": {"algorithm": "sha-256", "value": sha256_hex(strokes.to_string().as_bytes())},
    })
}

/// Web selectionBoardArgument.
pub fn board_argument(board_id: &str, revision: u64, targets: &[Value]) -> Value {
    json!({
        "board_id": board_id,
        "revision": revision,
        "targets": targets.iter().map(|t| {
            let mut v = json!({
                "target_id": t["target_id"], "node_id": t["node_id"], "kind": t["kind"],
                "world_bounds": t["world_bounds"], "overlap": t["overlap"], "distance": t["distance"], "z_index": t["z_index"],
            });
            if let Some(l) = t["label"].as_str() { v["label"] = json!(l); }
            if !t["value"].is_null() {
                let s: String = t["value"].to_string().chars().take(2000).collect();
                v["value_json"] = json!(s);
            }
            v
        }).collect::<Vec<_>>(),
    })
}

/// Web parseSelectionClassificationMetadata: (kind, content, confidence).
pub fn parse_classification(metadata: &Value) -> Result<(String, String, String), String> {
    let c = &metadata["selection_classification"];
    let kind = c["kind"].as_str().filter(|k| CONTENT_KINDS.iter().any(|(id, _)| id == k)).ok_or("选区识别类型无效")?;
    let confidence = c["confidence"].as_str().filter(|k| ["high", "medium", "low"].contains(k)).ok_or("选区识别可信度无效")?;
    let content = c["content"].as_str().ok_or("选区识别内容无效")?;
    Ok((kind.to_owned(), content.trim().to_owned(), confidence.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn lesson_requests_and_presentation() {
        assert!(is_lesson_request("结合这个公式给我上一课"));
        assert!(is_lesson_request("请系统地讲解一下"));
        assert!(!is_lesson_request("这一步为什么不对？"));
        assert_eq!(answer_presentation("explain", "", false), "lesson");
        assert_eq!(answer_presentation("custom-question", "帮我检查", false), "card");
        assert_eq!(answer_presentation("custom-question", "帮我检查", true), "board-writing");
    }

    #[test]
    fn request_text_mentions_targets() {
        let t = vec![json!({"label": "勾股定理", "value": {"latex": "a^2+b^2=c^2"}})];
        assert_eq!(
            format_lesson_request("请结合这部分内容给我上一节课。", &t, Some("x+1")),
            "请结合我选中的白板内容【勾股定理（a^2+b^2=c^2）】及识别出的内容【x+1】给我上一节课。"
        );
        assert_eq!(format_lesson_request(" 为什么？ ", &[], None), "为什么？");
    }

    #[test]
    fn candidates_rank_by_overlap() {
        let nodes = vec![json!({"id": "a", "kind": "math", "content": {"latex": "x"}}), json!({"id": "b", "kind": "note", "content": {"title": "B"}})];
        let rects = vec![("a".to_owned(), 0., 0., 100., 100., 0), ("b".to_owned(), 50., 0., 100., 100., 1)];
        let c = node_candidates(&nodes, &rects, (0., 0., 60., 60.));
        assert_eq!(c.len(), 2);
        assert_eq!(c[0]["node_id"], "a");
        assert_eq!(c[1]["label"], "B");
        assert_eq!(c[0]["value"]["latex"], "x");
    }
}
