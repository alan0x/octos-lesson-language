//! Diagram layout (web board-view.ts diagramLayout / orderedDiagramPath /
//! wrapDiagramLabel / diagramPosition / diagramConnectionGeometry): node
//! positions in the diagram's own SVG viewBox. A single 2-8 element chain
//! becomes a serpentine grid of boxes; anything else uses semantic positions
//! or a ring of dots in a 300x190 view.
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq)]
pub struct DiagramPoint {
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub lines: Vec<String>,
    /// Box size for ordered chains; dots otherwise.
    pub size: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiagramLayout {
    pub width: f64,
    pub height: f64,
    /// Element id -> point, in element order.
    pub points: Vec<(String, DiagramPoint)>,
    pub ordered: bool,
}

impl DiagramLayout {
    pub fn point(&self, id: &str) -> Option<&DiagramPoint> {
        self.points.iter().find(|(k, _)| k == id).map(|(_, p)| p)
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}
fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn wide(c: char) -> bool {
    c as u32 > 0xff
}

fn position(position: &str, index: usize, total: usize) -> (f64, f64) {
    match position {
        "top" => (150., 24.),
        "top_left" => (58., 34.),
        "top_right" => (242., 34.),
        "left" => (44., 94.),
        "center" => (150., 94.),
        "right" => (256., 94.),
        "bottom_left" => (42., 164.),
        "bottom_center" | "bottom" => (150., 164.),
        "bottom_right" => (258., 164.),
        _ => {
            let angle = std::f64::consts::TAU * index as f64 / total.max(1) as f64 - std::f64::consts::FRAC_PI_2;
            (150. + angle.cos() * 105., 94. + angle.sin() * 68.)
        }
    }
}

fn ordered_path(content: &Value) -> Option<Vec<String>> {
    let elements = list(&content["elements"]);
    let edges = list(&content["edges"]);
    if elements.len() < 2 || elements.len() > 8 || edges.len() != elements.len() - 1 {
        return None;
    }
    if elements.iter().any(|e| !text(&e["semantic_position"]).is_empty()) {
        return None;
    }
    let ids: Vec<String> = elements.iter().map(|e| text(&e["id"])).filter(|s| !s.is_empty()).collect();
    let unique: BTreeSet<&String> = ids.iter().collect();
    if unique.len() != elements.len() {
        return None;
    }
    let mut incoming: BTreeMap<&str, usize> = ids.iter().map(|id| (id.as_str(), 0)).collect();
    let mut outgoing: BTreeMap<&str, Vec<String>> = ids.iter().map(|id| (id.as_str(), Vec::new())).collect();
    for edge in edges {
        let (from, to) = (text(&edge["from"]), text(&edge["to"]));
        if !unique.contains(&from) || !unique.contains(&to) || from == to {
            return None;
        }
        *incoming.get_mut(to.as_str())? += 1;
        outgoing.get_mut(from.as_str())?.push(to);
    }
    let starts: Vec<&String> = ids.iter().filter(|id| incoming[id.as_str()] == 0).collect();
    let ends = ids.iter().filter(|id| outgoing[id.as_str()].is_empty()).count();
    if starts.len() != 1 || ends != 1 {
        return None;
    }
    if ids.iter().any(|id| incoming[id.as_str()] > 1 || outgoing[id.as_str()].len() > 1) {
        return None;
    }
    let mut ordered = Vec::new();
    let mut current = Some(starts[0].clone());
    while let Some(id) = current {
        if ordered.contains(&id) {
            break;
        }
        current = outgoing[id.as_str()].first().cloned();
        ordered.push(id);
    }
    (ordered.len() == ids.len()).then_some(ordered)
}

fn text_units(value: &str) -> usize {
    value.chars().map(|c| if wide(c) { 2 } else { 1 }).sum()
}

/// Web wrapDiagramLabel: break by character, CJK counting two units.
pub fn wrap_label(value: &str, max_units: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut units = 0;
    for c in value.trim().chars() {
        let w = if wide(c) { 2 } else { 1 };
        if !line.is_empty() && units + w > max_units {
            lines.push(line.trim_end().to_owned());
            line.clear();
            units = 0;
        }
        if line.is_empty() && c.is_whitespace() {
            continue;
        }
        line.push(c);
        units += w;
    }
    if !line.is_empty() {
        lines.push(line.trim_end().to_owned());
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

pub fn layout(content: &Value) -> DiagramLayout {
    let elements = list(&content["elements"]);
    let Some(path) = ordered_path(content) else {
        return DiagramLayout {
            width: 300.,
            height: 190.,
            ordered: false,
            points: elements
                .iter()
                .enumerate()
                .map(|(i, e)| {
                    let label = text(&e["label"]);
                    let (x, y) = position(&text(&e["semantic_position"]), i, elements.len());
                    (text(&e["id"]), DiagramPoint { x, y, lines: vec![label.clone()], label, size: None })
                })
                .collect(),
        };
    };
    let label_of = |id: &str| elements.iter().find(|e| text(&e["id"]) == id).map(|e| text(&e["label"])).unwrap_or_default();
    let longest = elements.iter().map(|e| text_units(&text(&e["label"]))).max().unwrap_or(0);
    let columns = if longest > 12 { 2.min(elements.len()) } else { 4.min(elements.len()) };
    let node_width = if columns <= 2 { 190. } else { 96. };
    let max_units = if columns <= 2 { 18 } else { 8 };
    let rows = elements.len().div_ceil(columns);
    let line_sets: Vec<Vec<String>> = path.iter().map(|id| wrap_label(&label_of(id), max_units)).collect();
    let heights: Vec<f64> = line_sets.iter().map(|l| (18. + l.len() as f64 * 17.).max(42.)).collect();
    let mut centers = Vec::new();
    let mut cursor = 22.;
    for row in 0..rows {
        let h = heights[row * columns..((row + 1) * columns).min(heights.len())]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        centers.push(cursor + h / 2.);
        cursor += h + 54.;
    }
    let width = 480.;
    let height = (cursor - 32.).max(190.);
    let points = elements
        .iter()
        .map(|e| {
            let id = text(&e["id"]);
            let index = path.iter().position(|p| *p == id).unwrap_or(0);
            let row = index / columns;
            let in_row = index % columns;
            let column = if row % 2 == 0 { in_row } else { columns - 1 - in_row };
            let x = if columns == 1 { width / 2. } else { width * (column as f64 + 0.5) / columns as f64 };
            let point = DiagramPoint {
                x,
                y: centers[row],
                label: text(&e["label"]),
                lines: line_sets[index].clone(),
                size: Some((node_width, heights[index])),
            };
            (id, point)
        })
        .collect();
    DiagramLayout { width, height, points, ordered: true }
}

/// Web connectionTargetRect for a diagram fragment: an 8x8 rect at the point,
/// mapped into the card's inner box (18px sides, 36px top, 16px bottom).
pub fn fragment_rect(content: &Value, fragment: &str, card: (f64, f64, f64, f64)) -> Option<(f64, f64, f64, f64)> {
    let layout = layout(content);
    let p = layout.point(fragment)?;
    let (x, y, w, h) = card;
    let (iw, ih) = ((w - 36.).max(1.), (h - 52.).max(1.));
    Some((x + 18. + p.x / layout.width * iw - 4., y + 36. + p.y / layout.height * ih - 4., 8., 8.))
}

#[derive(Clone, Debug, PartialEq)]
pub struct InternalConnection {
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub label: String,
    /// Badge centre x, y and width (22px tall).
    pub label_at: (f64, f64, f64),
}

/// Web diagramConnectionGeometry: a connection between two fragments of the
/// same diagram is drawn inside the diagram's viewBox.
pub fn internal_connection(content: &Value, connection: &Value) -> Option<InternalConnection> {
    let layout = layout(content);
    let from = layout.point(&text(&connection["from"]["fragment_id"]))?;
    let to = layout.point(&text(&connection["to"]["fragment_id"]))?;
    let label = text(&connection["label"]);
    let width = (label.chars().map(|c| if wide(c) { 12. } else { 7. }).sum::<f64>() + 16.).clamp(42., 112.);
    Some(InternalConnection {
        from: (from.x, from.y),
        to: (to.x, to.y),
        label_at: ((from.x + to.x) / 2. + width / 2. + 12., (from.y + to.y) / 2., width),
        label,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chain_becomes_serpentine_boxes() {
        let content = json!({
            "elements": [
                {"id": "a", "label": "移项：将常数项移至右边"},
                {"id": "b", "label": "配方"},
                {"id": "c", "label": "开平方"},
            ],
            "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}],
        });
        let l = layout(&content);
        assert!(l.ordered);
        // Longest label is 22 units > 12: two columns of 190-wide boxes.
        let a = l.point("a").unwrap();
        let b = l.point("b").unwrap();
        let c = l.point("c").unwrap();
        assert_eq!((a.x, b.x, c.x), (120., 360., 360.));
        assert_eq!(a.lines, vec!["移项：将常数项移至", "右边"]);
        assert_eq!(a.size, Some((190., 52.)));
        assert_eq!(a.y, 22. + 26.);
        assert_eq!(c.y, 22. + 52. + 54. + 21.);
        assert_eq!(l.height, 192.);
    }

    #[test]
    fn non_chain_uses_ring_of_dots() {
        let content = json!({
            "elements": [{"id": "a", "label": "A", "semantic_position": "top"}, {"id": "b", "label": "B"}],
            "edges": [],
        });
        let l = layout(&content);
        assert!(!l.ordered);
        assert_eq!((l.point("a").unwrap().x, l.point("a").unwrap().y), (150., 24.));
        assert!(l.point("b").unwrap().size.is_none());
    }

    #[test]
    fn wrap_skips_leading_spaces() {
        assert_eq!(wrap_label("ab cd", 3), vec!["ab", "cd"]);
        assert_eq!(wrap_label("", 3), vec![""]);
    }
}
