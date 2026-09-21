//! Platform-independent orthogonal routes; mirrors web-runtime/connection-layout.ts.
use crate::spatial::Rect;
pub type Point = (f64, f64);
#[derive(Clone, Debug)]
pub struct Route {
    pub points: Vec<Point>,
    pub label: Option<Rect>,
}
fn overlaps(a: Rect, b: Rect, p: f64) -> bool {
    a.x < b.x + b.width + p
        && a.x + a.width + p > b.x
        && a.y < b.y + b.height + p
        && a.y + a.height + p > b.y
}
fn center(r: Rect) -> Point {
    (r.x + r.width / 2., r.y + r.height / 2.)
}
fn port(r: Rect, s: usize, c: bool) -> Point {
    if c {
        return center(r);
    }
    let (x, y) = center(r);
    match s {
        0 => (x, r.y),
        1 => (r.x + r.width, y),
        2 => (x, r.y + r.height),
        _ => (r.x, y),
    }
}
fn compact(points: Vec<Point>) -> Vec<Point> {
    let mut out: Vec<Point> = vec![];
    for p in points {
        if out.last() == Some(&p) {
            continue;
        }
        if out.len() > 1 {
            let a = out[out.len() - 2];
            let b = out[out.len() - 1];
            if (a.0 == b.0 && b.0 == p.0) || (a.1 == b.1 && b.1 == p.1) {
                *out.last_mut().unwrap() = p;
                continue;
            }
        }
        out.push(p)
    }
    out
}
fn dogleg(a: Point, b: Point, h: bool) -> Vec<Point> {
    if h {
        let x = (a.0 + b.0) / 2.;
        compact(vec![a, (x, a.1), (x, b.1), b])
    } else {
        let y = (a.1 + b.1) / 2.;
        compact(vec![a, (a.0, y), (b.0, y), b])
    }
}
fn length(a: Point, b: Point) -> f64 {
    (a.0 - b.0).abs() + (a.1 - b.1).abs()
}
fn intersects(a: Point, b: Point, r: Rect) -> bool {
    if a.0 == b.0 {
        a.0 >= r.x - 10.
            && a.0 <= r.x + r.width + 10.
            && a.1.max(b.1) >= r.y - 10.
            && a.1.min(b.1) <= r.y + r.height + 10.
    } else if a.1 == b.1 {
        a.1 >= r.y - 10.
            && a.1 <= r.y + r.height + 10.
            && a.0.max(b.0) >= r.x - 10.
            && a.0.min(b.0) <= r.x + r.width + 10.
    } else {
        true
    }
}
pub fn route(
    from: Rect,
    to: Rect,
    label: &str,
    centers: bool,
    occupied: &[Rect],
    labels: &mut Vec<Rect>,
) -> Route {
    let corridor = Rect::union(&[from, to], 0.).unwrap();
    let obstacles: Vec<_> = occupied
        .iter()
        .copied()
        .filter(|r| *r != from && *r != to && overlaps(*r, corridor, 28.))
        .collect();
    let mut candidates = vec![];
    for (gap, a, b, h) in [
        (to.y - from.y - from.height, 2, 0, false),
        (from.y - to.y - to.height, 0, 2, false),
        (to.x - from.x - from.width, 1, 3, true),
        (from.x - to.x - to.width, 3, 1, true),
    ] {
        if gap >= 0. {
            candidates.push((
                dogleg(port(from, a, centers), port(to, b, centers), h),
                false,
            ));
        }
    }
    if candidates.is_empty() && centers {
        let a = center(from);
        let b = center(to);
        candidates.push((dogleg(a, b, (b.0 - a.0).abs() >= (b.1 - a.1).abs()), false));
    }
    let mut all = obstacles.clone();
    all.extend([from, to]);
    let bounds = Rect::union(&all, 28.).unwrap();
    for side in 0..4 {
        let a = port(from, side, centers);
        let b = port(to, side, centers);
        let pts = match side {
            0 | 2 => {
                let y = if side == 0 {
                    bounds.y
                } else {
                    bounds.y + bounds.height
                };
                vec![a, (a.0, y), (b.0, y), b]
            }
            _ => {
                let x = if side == 3 {
                    bounds.x
                } else {
                    bounds.x + bounds.width
                };
                vec![a, (x, a.1), (x, b.1), b]
            }
        };
        candidates.push((compact(pts), true));
    }
    for candidate in &mut candidates {
        candidate.0 = compact(std::mem::take(&mut candidate.0));
    }
    let score = |p: &Vec<Point>, outer: bool| {
        p.windows(2)
            .map(|s| {
                length(s[0], s[1])
                    + obstacles
                        .iter()
                        .filter(|r| intersects(s[0], s[1], **r))
                        .count() as f64
                        * 1_000_000.
            })
            .sum::<f64>()
            + p.len().saturating_sub(2) as f64 * 18.
            + if outer { 80. } else { 0. }
    };
    candidates.sort_by(|a, b| score(&a.0, a.1).total_cmp(&score(&b.0, b.1)));
    let points = candidates.remove(0).0;
    let width = (label
        .chars()
        .map(|c| if c as u32 > 255 { 12. } else { 7. })
        .sum::<f64>()
        + 22.)
        .clamp(64., 220.);
    let mut segments = points.windows(2).collect::<Vec<_>>();
    segments.sort_by(|a, b| length(b[0], b[1]).total_cmp(&length(a[0], a[1])));
    let mut positions = vec![];
    for s in segments {
        let x = (s[0].0 + s[1].0) / 2.;
        let y = (s[0].1 + s[1].1) / 2.;
        if s[0].1 == s[1].1 {
            positions.extend([(x, y - 19.), (x, y + 19.)]);
        } else {
            positions.extend([(x + width / 2. + 7., y), (x - width / 2. - 7., y)]);
        }
    }
    let badge = if label.is_empty() {
        None
    } else {
        positions
            .into_iter()
            .map(|(x, y)| Rect {
                x: x - width / 2.,
                y: y - 12.,
                width,
                height: 24.,
            })
            .find(|r| !labels.iter().any(|o| overlaps(*r, *o, 6.)))
    };
    if let Some(r) = badge {
        labels.push(r)
    }
    Route {
        points,
        label: badge,
    }
}
