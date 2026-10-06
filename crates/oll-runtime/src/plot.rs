//! Function plots ported from packages/web-runtime: plot.ts (frame,
//! sampling, secant measurement, label formats), axis-ticks.ts
//! (planAxisTicks) and board-view.ts drawPlot, which this module turns into
//! renderer-independent primitives in the SVG viewBox the Web uses.
use crate::expression::{evaluate, Variables};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}
impl Range {
    pub fn span(&self) -> f64 {
        self.max - self.min
    }
}
/// Web plotRange / validCoordinateRange.
pub fn range(value: &Value, fallback: Range) -> Range {
    let (min, max) = (value["min"].as_f64(), value["max"].as_f64());
    match (min, max) {
        (Some(min), Some(max)) if min.is_finite() && max.is_finite() && max > min => Range { min, max },
        _ => fallback,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
    pub width: f64,
    pub height: f64,
}
/// Web plotFrame: letterbox equal-unit plots without changing the range.
pub fn plot_frame(width: f64, height: f64, x: Range, y: Range, equal_scale: bool) -> Frame {
    let (aw, ah) = (width - 42., height - 34.);
    let scale = (aw / x.span()).min(ah / y.span());
    let w = if equal_scale { scale * x.span() } else { aw };
    let h = if equal_scale { scale * y.span() } else { ah };
    let left = 30. + (aw - w) / 2.;
    let top = 10. + (ah - h) / 2.;
    Frame { left, right: left + w, top, bottom: top + h, width: w, height: h }
}

/// Web planAxisTicks result.
#[derive(Clone, Debug, PartialEq)]
pub struct Ticks {
    pub major: Vec<f64>,
    pub minor: Vec<f64>,
    pub step: f64,
}
fn nice_step(raw: f64) -> f64 {
    if !raw.is_finite() || raw <= 0. {
        return 1.;
    }
    let power = 10f64.powf(raw.log10().floor());
    let normalized = raw / power;
    [1., 2., 5., 10.].into_iter().find(|m| normalized <= *m).unwrap_or(10.) * power
}
fn tick_values(range: Range, step: f64, max_count: usize) -> Vec<f64> {
    let epsilon = step * 1e-9;
    let first = ((range.min - epsilon) / step).ceil();
    let last = ((range.max + epsilon) / step).floor();
    if !first.is_finite() || !last.is_finite() || last < first || (last - first + 1.) as usize > max_count {
        return vec![];
    }
    (0..=(last - first) as i64)
        .map(|i| {
            let v = (first + i as f64) * step;
            if v.abs() <= epsilon { 0. } else { v }
        })
        .collect()
}
/// Web planAxisTicks (maxTickCount 200, minMinorPixelSpacing 20).
pub fn plan_axis_ticks(range: Range, pixel_length: f64, min_major_spacing: f64, previous: Option<f64>) -> Ticks {
    let span = range.span();
    let max_count = 200;
    let min_major = min_major_spacing.max(24.);
    let pixels = if pixel_length.is_finite() && pixel_length > 0. { pixel_length } else { 240. };
    let intervals = (pixels / min_major).floor().max(1.);
    let mut step = nice_step(span / intervals);
    if let Some(prev) = previous.filter(|p| p.is_finite() && *p > 0.) {
        let spacing = pixels * prev / span;
        if spacing >= min_major * 0.82 && spacing <= min_major * 2.35 {
            step = prev;
        }
    }
    let mut major = tick_values(range, step, max_count);
    while major.is_empty() && step < span * 10. {
        step = nice_step(step * 1.01);
        major = tick_values(range, step, max_count);
    }
    let lead = step / 10f64.powf(step.log10().floor());
    let minor_step = step / if (lead - 2.).abs() < 1e-10 { 2. } else { 5. };
    let minor_spacing = pixels * minor_step / span;
    let major_keys: Vec<i64> = major.iter().map(|v| (v / minor_step).round() as i64).collect();
    let minor = if minor_spacing >= 20. {
        tick_values(range, minor_step, max_count * 5)
            .into_iter()
            .filter(|v| !major_keys.contains(&((v / minor_step).round() as i64)))
            .collect()
    } else {
        vec![]
    };
    Ticks { major, minor, step }
}
/// JS Number.prototype.toString for the short decimals of tick labels.
pub fn js_number(v: f64) -> String {
    if v == 0. {
        return "0".into();
    }
    if v == v.trunc() && v.abs() < 1e21 {
        return format!("{}", v as i64);
    }
    // Shortest representation that round-trips, like JS.
    let s = format!("{v}");
    s
}
/// JS (value).toFixed(d) then Number(...).toString().
fn fixed_number(v: f64, decimals: usize) -> String {
    let rounded: f64 = format!("{v:.decimals$}").parse().unwrap_or(v);
    js_number(if rounded == 0. { 0. } else { rounded })
}
impl Ticks {
    /// Web AxisTickPlan.format.
    pub fn format(&self, value: f64) -> String {
        if !value.is_finite() {
            return String::new();
        }
        let normalized = if value.abs() < self.step * 1e-9 { 0. } else { value };
        if normalized.abs() >= 1e9 || (normalized.abs() > 0. && normalized.abs() < 1e-6) {
            let s = format!("{normalized:.2e}");
            // JS: 1.00e+9 style with explicit sign; trim .00/.0 mantissas.
            let (m, e) = s.split_once('e').unwrap_or((&s, "0"));
            let e: i32 = e.parse().unwrap_or(0);
            let m = m.trim_end_matches(".00").trim_end_matches(".0");
            return format!("{m}e{}{}", if e >= 0 { "+" } else { "-" }, e.abs());
        }
        let decimals = (-(self.step.log10().floor())).clamp(0., 12.) as usize;
        fixed_number(normalized, decimals)
    }
}

/// Web normalizedExpression for plot expressions (strips a leading `y =`).
fn normalized(expression: &str) -> Option<String> {
    let mut e = expression.trim().to_owned();
    if e.len() >= 1 && (e.starts_with('y') || e.starts_with('Y')) {
        let rest = e[1..].trim_start();
        if let Some(r) = rest.strip_prefix('=') {
            e = r.to_owned();
        }
    }
    let e = e.trim().to_owned();
    (!e.is_empty() && e.encode_utf16().count() <= 256).then_some(e)
}
/// Evaluate a plot expression at x (NaN on any failure).
pub fn eval_at(expression: &str, x: f64, variables: &Variables) -> f64 {
    let Some(e) = normalized(expression) else { return f64::NAN };
    let mut values = variables.clone();
    values.insert("x".into(), x);
    evaluate(&e, &values).unwrap_or(f64::NAN)
}
fn eval_xy(expression: &str, x: f64, y: f64, variables: &Variables) -> f64 {
    let Some(e) = normalized(expression) else { return f64::NAN };
    let mut values = variables.clone();
    values.insert("x".into(), x);
    values.insert("y".into(), y);
    evaluate(&e, &values).unwrap_or(f64::NAN)
}

pub type Segment = Vec<(f64, f64)>;
/// Web samplePlotExpression: segments split at non-finite values and jumps.
pub fn sample(expression: &str, x: Range, y: Range, count: usize, variables: &Variables) -> Vec<Segment> {
    let count = count.clamp(2, 1001);
    let jump = y.span() * 2.;
    let magnitude = y.min.abs().max(y.max.abs()).max(1.) * 10_000.;
    let mut segments = Vec::new();
    let mut segment: Segment = Vec::new();
    let flush = |segment: &mut Segment, segments: &mut Vec<Segment>| {
        if segment.len() > 1 {
            segments.push(std::mem::take(segment));
        }
        segment.clear();
    };
    for i in 0..count {
        let xv = x.min + x.span() * i as f64 / (count - 1) as f64;
        let yv = eval_at(expression, xv, variables);
        if !yv.is_finite() || yv.abs() > magnitude {
            flush(&mut segment, &mut segments);
            continue;
        }
        if segment.last().is_some_and(|p| (yv - p.1).abs() > jump) {
            flush(&mut segment, &mut segments);
        }
        segment.push((xv, yv));
    }
    flush(&mut segment, &mut segments);
    segments
}
/// Web sampleImplicitPlotExpression (marching squares).
pub fn sample_implicit(expression: &str, x: Range, y: Range, level: f64, samples: usize, variables: &Variables) -> Vec<Segment> {
    let n = samples.clamp(16, 200);
    let at = |i: usize, j: usize| {
        let xv = x.min + x.span() * i as f64 / n as f64;
        let yv = y.min + y.span() * j as f64 / n as f64;
        eval_xy(expression, xv, yv, variables) - level
    };
    let grid: Vec<Vec<f64>> = (0..=n).map(|i| (0..=n).map(|j| at(i, j)).collect()).collect();
    let mut segments = Vec::new();
    for i in 0..n {
        let x0 = x.min + x.span() * i as f64 / n as f64;
        let x1 = x.min + x.span() * (i + 1) as f64 / n as f64;
        for j in 0..n {
            let y0 = y.min + y.span() * j as f64 / n as f64;
            let y1 = y.min + y.span() * (j + 1) as f64 / n as f64;
            let points = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)];
            let values = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
            if values.iter().any(|v| !v.is_finite()) {
                continue;
            }
            let mut crossings = Vec::new();
            for (from, to) in [(0, 1), (1, 2), (2, 3), (3, 0)] {
                let (a, b) = (values[from], values[to]);
                if (a <= 0. && b > 0.) || (a > 0. && b <= 0.) {
                    let d = a - b;
                    let t = if d.abs() < 1e-12 { 0.5 } else { a / d };
                    let (p, q) = (points[from], points[to]);
                    crossings.push((p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t));
                }
            }
            if crossings.len() == 2 {
                segments.push(vec![crossings[0], crossings[1]]);
            } else if crossings.len() == 4 {
                let center = eval_xy(expression, (x0 + x1) / 2., (y0 + y1) / 2., variables) - level;
                let pairs = if center <= 0. { [(0, 1), (2, 3)] } else { [(0, 3), (1, 2)] };
                for (a, b) in pairs {
                    segments.push(vec![crossings[a], crossings[b]]);
                }
            }
        }
    }
    segments
}

/// Web secantMeasurement.
pub fn secant(a: (f64, f64), b: (f64, f64)) -> Option<(f64, f64, f64)> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    if ![a.0, a.1, b.0, b.1, dx, dy].iter().all(|v| v.is_finite())
        || dx.abs() <= 1e-9 * 1f64.max(a.0.abs()).max(b.0.abs())
    {
        return None;
    }
    let slope = dy / dx;
    slope.is_finite().then_some((dx, dy, slope))
}
/// JS Number(n.toPrecision(5)).toString().
pub fn precision5(n: f64) -> String {
    if n == 0. || !n.is_finite() {
        return js_number(if n.is_finite() { 0. } else { n });
    }
    let digits = 5 - 1 - n.abs().log10().floor() as i32;
    let rounded: f64 = if digits >= 0 {
        format!("{:.*}", digits as usize, n).parse().unwrap_or(n)
    } else {
        let f = 10f64.powi(-digits);
        (n / f).round() * f
    };
    js_number(rounded)
}
fn round_to(n: f64, factor: f64) -> String {
    let r = (n * factor).round() / factor;
    js_number(if r == 0. { 0. } else { r })
}
/// Web formatPointLabel.
pub fn format_point_label(raw: &str, x: f64, y: f64) -> String {
    let num = |n: f64| if n.is_finite() { round_to(n, 1000.) } else { String::new() };
    raw.replace("{x}", &num(x))
        .replace("{y}", &num(y))
        .replace("{coords}", &format!("({}, {})", num(x), num(y)))
}
/// Web formatLinearCurveEquation.
pub fn format_linear_equation(expression: &str, variables: &Variables) -> Option<String> {
    let f = |x| eval_at(expression, x, variables);
    let (y0, y1, y2, yn) = (f(0.), f(1.), f(2.), f(-1.));
    if ![y0, y1, y2, yn].iter().all(|v| v.is_finite()) {
        return None;
    }
    let (slope, intercept) = (y1 - y0, y0);
    if (y2 - (2. * slope + intercept)).abs() > 1e-5 || (yn - (-slope + intercept)).abs() > 1e-5 {
        return None;
    }
    let num = |n: f64| round_to(n, 100.);
    if slope.abs() < 1e-5 {
        return Some(format!("y = {}", num(intercept)));
    }
    let m = if (slope - 1.).abs() < 1e-5 {
        "x".to_owned()
    } else if (slope + 1.).abs() < 1e-5 {
        "-x".to_owned()
    } else {
        format!("{}x", num(slope))
    };
    Some(if intercept.abs() < 1e-5 {
        format!("y = {m}")
    } else if intercept > 0. {
        format!("y = {m} + {}", num(intercept))
    } else {
        format!("y = {m} - {}", num(intercept.abs()))
    })
}

/// Drawing classes (web CSS) of plot primitives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    GridMinor,
    Grid,
    Axis,
    Guide,
    Secant,
    /// Curve of a series (0..6), dashed per series like the Web.
    Curve(usize),
    Point,
    AxisLabel,
    PointLabel,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Primitive {
    Line { x1: f64, y1: f64, x2: f64, y2: f64, style: Style, emphasis: Option<String>, clip: bool },
    Path { segments: Vec<Segment>, style: Style, emphasis: Option<String> },
    Circle { cx: f64, cy: f64, r: f64, style: Style, emphasis: Option<String> },
    /// `anchor`: start | middle | end (SVG text-anchor), baseline at y.
    Text { x: f64, y: f64, text: String, anchor: &'static str, style: Style },
}
/// One legend entry (web .plot-legend-item).
#[derive(Clone, Debug, PartialEq)]
pub struct LegendItem {
    pub text: String,
    /// Index into content.curves (the legend checkbox toggles this curve).
    pub index: usize,
    pub series: usize,
    pub hidden: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct PlotScene {
    pub width: f64,
    pub height: f64,
    pub frame: Frame,
    pub primitives: Vec<Primitive>,
    pub measurement: Option<String>,
    pub hint: Option<String>,
    pub legend: Vec<LegendItem>,
    pub ticks: (f64, f64),
    pub x: Range,
    pub y: Range,
}

/// Web legend / probe label: the curve label (or expression), with the
/// evaluated linear equation appended under default x/y axis names.
fn curve_label(curve: &Value, axes: &Value, variables: &Variables) -> String {
    let expression = curve["expression"].as_str().unwrap_or("");
    let base = curve["label"].as_str().filter(|s| !s.is_empty()).unwrap_or(expression).to_owned();
    let name = |a: &Value, d: &str| a["label"].as_str().filter(|s| !s.is_empty()).unwrap_or(d).to_owned();
    let default_names = name(&axes["x"], "x") == "x" && name(&axes["y"], "y") == "y";
    match default_names.then(|| format_linear_equation(expression, variables)).flatten() {
        Some(eq) if eq != base => format!("{base}（{eq}）"),
        _ => base,
    }
}
/// Web plot-explorer readout text before the pointer reads a curve.
pub fn readout_idle(exploring: bool, any_hidden: bool) -> &'static str {
    if any_hidden {
        "部分曲线已隐藏；练习前请恢复课程视图。"
    } else if exploring {
        "探索中：拖动空白平移，滚轮/双指缩放。"
    } else {
        "指向曲线查看坐标"
    }
}
/// A pointer reading of one curve (web plot-explorer onpointermove).
#[derive(Clone, Debug, PartialEq)]
pub struct Probe {
    pub index: usize,
    pub x: f64,
    pub y: f64,
    pub text: String,
}
/// Web plot-explorer probe: at the pointer's x (frame fractions `fx`, `fy`,
/// y up), the visible explicit curve whose in-range value lies nearest the
/// pointer. `None` means 当前位置没有可读曲线.
pub fn probe(node: &Value, variables: &Variables, x: Range, y: Range, hidden: &[usize], fx: f64, fy: f64) -> Option<Probe> {
    let axes = &node["content"]["axes"];
    let px = x.min + fx.clamp(0., 1.) * x.span();
    let fy = fy.clamp(0., 1.);
    let curves = node["content"]["curves"].as_array()?;
    let hit = curves
        .iter()
        .enumerate()
        .filter(|(i, c)| !hidden.contains(i) && c["kind"] != "implicit")
        .filter_map(|(i, c)| {
            let v = eval_at(c["expression"].as_str()?, px, variables);
            (v.is_finite() && v >= y.min && v <= y.max).then(|| (i, c, v, ((v - y.min) / y.span() - fy).abs()))
        })
        .min_by(|a, b| a.3.total_cmp(&b.3))?;
    let name = |a: &Value, d: &str| a["label"].as_str().filter(|s| !s.is_empty()).unwrap_or(d).to_owned();
    let text = format!(
        "{}：{} ≈ {}，{} ≈ {}",
        curve_label(hit.1, axes, variables),
        name(&axes["x"], "x"),
        precision5(px),
        name(&axes["y"], "y"),
        precision5(hit.2)
    );
    Some(Probe { index: hit.0, x: px, y: hit.2, text })
}
/// Series dash patterns (stroke-dasharray) of plot-series-0..5.
pub fn series_dash(series: usize) -> &'static [f64] {
    match series % 6 {
        1 => &[6., 3.],
        2 => &[2., 3.],
        3 => &[8., 3., 2., 3.],
        4 => &[10., 4.],
        5 => &[3., 2.],
        _ => &[],
    }
}
/// Web latestEmphasis (+ emphasisClassName normalisation): the latest
/// emphasis of a content fragment, or of the node itself for `""`.
pub fn latest_emphasis(node: &Value, fragment: &str) -> Option<String> {
    let entry = node["emphasis"].as_array()?.iter().rev().find(|e| {
        let f = e["target"]["fragment_id"].as_str();
        if fragment.is_empty() { f.is_none() } else { f == Some(fragment) }
    })?;
    let e = entry["emphasis"].as_str()?.trim().to_lowercase();
    if e.is_empty() {
        return None;
    }
    Some(if ["focus", "supporting", "warning", "resolved"].contains(&e.as_str()) { e } else { "focus".into() })
}

/// Web drawPlot (+ renderPlotExplorer legend): the plot of `node` at
/// `width`×`height`, optionally with explorer ranges and hidden curves.
/// `previous_ticks` keeps tick steps stable across redraws.
pub fn plot_scene(
    node: &Value,
    variables: &Variables,
    width: f64,
    height: f64,
    ranges: Option<(Range, Range)>,
    hidden: &[usize],
    previous_ticks: Option<(f64, f64)>,
) -> PlotScene {
    let content = &node["content"];
    let axes = &content["axes"];
    let default = Range { min: -5., max: 5. };
    let (xr, yr) = ranges.unwrap_or((range(&axes["x"], default), range(&axes["y"], default)));
    let f = plot_frame(width, height, xr, yr, axes["equal_scale"] == true);
    let map_x = |v: f64| f.left + (v - xr.min) / xr.span() * (f.right - f.left);
    let map_y = |v: f64| f.bottom - (v - yr.min) / yr.span() * (f.bottom - f.top);
    let mut out = Vec::new();
    let line = |x1, y1, x2, y2, style| Primitive::Line { x1, y1, x2, y2, style, emphasis: None, clip: false };
    let label = |x, y, text: String, anchor| Primitive::Text { x, y, text, anchor, style: Style::AxisLabel };
    let xt = plan_axis_ticks(xr, f.right - f.left, 46., previous_ticks.map(|t| t.0));
    let yt = plan_axis_ticks(yr, f.bottom - f.top, 34., previous_ticks.map(|t| t.1));
    for v in &xt.minor {
        out.push(line(map_x(*v), f.top, map_x(*v), f.bottom, Style::GridMinor));
    }
    for v in &yt.minor {
        out.push(line(f.left, map_y(*v), f.right, map_y(*v), Style::GridMinor));
    }
    for v in &xt.major {
        out.push(line(map_x(*v), f.top, map_x(*v), f.bottom, Style::Grid));
        out.push(label(map_x(*v), height - 4., xt.format(*v), "middle"));
    }
    for v in &yt.major {
        out.push(line(f.left, map_y(*v), f.right, map_y(*v), Style::Grid));
        out.push(label(f.left - 5., map_y(*v) + 3., yt.format(*v), "end"));
    }
    if yr.min <= 0. && yr.max >= 0. {
        out.push(line(f.left, map_y(0.), f.right, map_y(0.), Style::Axis));
    }
    if xr.min <= 0. && xr.max >= 0. {
        out.push(line(map_x(0.), f.top, map_x(0.), f.bottom, Style::Axis));
    }
    let axis_name = |a: &Value, d: &str| a["label"].as_str().filter(|s| !s.is_empty()).unwrap_or(d).to_owned();
    out.push(label(f.right, f.bottom - 5., axis_name(&axes["x"], "x"), "end"));
    out.push(label(f.left + 6., f.top + 9., axis_name(&axes["y"], "y"), "start"));

    for guide in content["guides"].as_array().into_iter().flatten() {
        let Some(value) = guide["value"].as_f64().filter(|v| v.is_finite()) else { continue };
        let horizontal = guide["kind"] == "horizontal_line";
        if if horizontal { value < yr.min || value > yr.max } else { value < xr.min || value > xr.max } {
            continue;
        }
        let id = guide["id"].as_str().unwrap_or("");
        let (x1, y1, x2, y2) = if horizontal {
            (f.left, map_y(value), f.right, map_y(value))
        } else {
            (map_x(value), f.top, map_x(value), f.bottom)
        };
        out.push(Primitive::Line { x1, y1, x2, y2, style: Style::Guide, emphasis: latest_emphasis(node, id), clip: false });
        if let Some(text) = guide["label"].as_str().filter(|s| !s.is_empty()) {
            let (x, y, anchor) = if horizontal {
                (f.right - 3., map_y(value) - 4., "end")
            } else {
                (map_x(value) + 4., f.top + 10., "start")
            };
            out.push(label(x, y, text.to_owned(), anchor));
        }
    }

    let curves = content["curves"].as_array().cloned().unwrap_or_default();
    let mut legend = Vec::new();
    for (index, curve) in curves.iter().enumerate() {
        let Some(expression) = curve["expression"].as_str().filter(|s| !s.is_empty()) else { continue };
        let series = curve["plotSeries"].as_u64().map_or(index, |s| s as usize) % 6;
        let text = curve_label(curve, axes, variables);
        let hidden_curve = hidden.contains(&index);
        legend.push(LegendItem { text, index, series: index % 6, hidden: hidden_curve });
        if hidden_curve {
            continue;
        }
        let samples = if curve["kind"] == "implicit" {
            sample_implicit(
                expression,
                xr,
                yr,
                curve["level"].as_f64().unwrap_or(0.),
                curve["samples"].as_u64().unwrap_or(80) as usize,
                variables,
            )
        } else {
            sample(expression, xr, yr, (width.max(241.)).min(1001.) as usize, variables)
        };
        if samples.is_empty() {
            continue;
        }
        let segments = samples
            .into_iter()
            .map(|s| s.into_iter().map(|(x, y)| (map_x(x), map_y(y))).collect())
            .collect();
        out.push(Primitive::Path {
            segments,
            style: Style::Curve(series),
            emphasis: curve["id"].as_str().and_then(|id| latest_emphasis(node, id)),
        });
    }

    let points = content["points"].as_array().cloned().unwrap_or_default();
    let mut measurement = None;
    let mut hint = None;
    if content["measurement"] == "secant" && points.len() == 2 {
        let p = |v: &Value| (v["x"].as_f64().unwrap_or(f64::NAN), v["y"].as_f64().unwrap_or(f64::NAN));
        let (a, b) = (p(&points[0]), p(&points[1]));
        let m = secant(a, b);
        if m.is_some() {
            let clip = |x1, y1, x2, y2, style| Primitive::Line { x1, y1, x2, y2, style, emphasis: None, clip: true };
            out.push(clip(map_x(a.0), map_y(a.1), map_x(b.0), map_y(b.1), Style::Secant));
            out.push(clip(map_x(a.0), map_y(a.1), map_x(b.0), map_y(a.1), Style::Guide));
            out.push(clip(map_x(b.0), map_y(a.1), map_x(b.0), map_y(b.1), Style::Guide));
        }
        measurement = Some(match m {
            Some((dx, dy, slope)) => format!(
                "Δx = {} · Δy = {} · 割线斜率 ≈ {}",
                precision5(dx),
                precision5(dy),
                precision5(slope)
            ),
            None => "两点横坐标重合或过近，不能用 Δy/Δx 计算斜率。".into(),
        });
        hint = Some(match content["hint"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
            Some(h) => h.to_owned(),
            None => {
                let names: Vec<&str> = points.iter().filter_map(|p| p["label"].as_str()).filter(|s| !s.is_empty()).collect();
                let refs = if names.len() == 2 { format!("{}、{}", names[0], names[1]) } else { "两点".into() };
                if content["sample_input"] == "fixed_x" {
                    format!("{refs}的横坐标固定；曲线参数变化时同步观察两点与割线。")
                } else {
                    format!("通过滑块调整{refs}的横坐标。")
                }
            }
        });
    }
    for point in &points {
        if point["binding_undefined"] == true {
            continue;
        }
        let (Some(px), Some(py)) = (point["x"].as_f64(), point["y"].as_f64()) else { continue };
        if !px.is_finite() || !py.is_finite() || px < xr.min || px > xr.max || py < yr.min || py > yr.max {
            continue;
        }
        let (x, y) = (map_x(px), map_y(py));
        let id = point["id"].as_str().unwrap_or("");
        out.push(Primitive::Circle { cx: x, cy: y, r: 5., style: Style::Point, emphasis: latest_emphasis(node, id) });
        if let Some(raw) = point["label"].as_str().filter(|s| !s.is_empty()) {
            let near_right = x > f.right - 44.;
            let near_top = y < f.top + 18.;
            out.push(Primitive::Text {
                x: if near_right { x - 8. } else { x + 8. },
                y: if near_top { y + 16. } else { y - 8. },
                text: format_point_label(raw, px, py),
                anchor: if near_right { "end" } else { "start" },
                style: Style::PointLabel,
            });
        }
    }
    PlotScene {
        width,
        height,
        frame: f,
        primitives: out,
        measurement,
        hint,
        legend,
        ticks: (xt.step, yt.step),
        x: xr,
        y: yr,
    }
}

/// Web zoomCoordinateRanges.
pub fn zoom(x: Range, y: Range, factor: f64, anchor: (f64, f64)) -> (Range, Range) {
    if !factor.is_finite() || factor <= 0. {
        return (x, y);
    }
    let (sx, sy) = (x.span() * factor, y.span() * factor);
    if [sx, sy].iter().any(|s| !s.is_finite() || *s < 1e-7 || *s > 1e9) {
        return (x, y);
    }
    let axis = |r: Range, span: f64, amount: f64| {
        let a = amount.clamp(0., 1.);
        let fixed = r.min + r.span() * a;
        Range { min: fixed - span * a, max: fixed + span * (1. - a) }
    };
    let (nx, ny) = (axis(x, sx, anchor.0), axis(y, sy, anchor.1));
    if [nx.min, nx.max, ny.min, ny.max].iter().all(|v| v.is_finite() && v.abs() <= 1e12) {
        (nx, ny)
    } else {
        (x, y)
    }
}
/// Web panCoordinateRanges.
pub fn pan(x: Range, y: Range, dx: f64, dy: f64) -> (Range, Range) {
    let (nx, ny) = (Range { min: x.min + dx, max: x.max + dx }, Range { min: y.min + dy, max: y.max + dy });
    if [nx.min, nx.max, ny.min, ny.max].iter().all(|v| v.is_finite() && v.abs() <= 1e12) {
        (nx, ny)
    } else {
        (x, y)
    }
}
/// Web coordinateWheelZoomFactor (pixel deltas).
pub fn wheel_zoom_factor(delta_y: f64) -> f64 {
    (delta_y * 0.0018).clamp(-0.24, 0.24).exp()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn probe_reads_the_nearest_visible_curve_like_the_web() {
        let node = serde_json::json!({"content": {"axes": {}, "curves": [
            {"expression": "x^2+1", "label": "截线 z=x²+1"},
            {"expression": "2*x", "label": "P处切线 z=2x"},
            {"kind": "implicit", "expression": "x^2+y^2-1"}
        ]}});
        let vars = Variables::new();
        let r = Range { min: -5., max: 5. };
        // x = 1: both curves read 2 (fraction .7); the first wins the tie.
        let p = probe(&node, &vars, r, r, &[], 0.6, 0.7).unwrap();
        assert_eq!((p.index, p.x, p.y), (0, 1., 2.));
        assert_eq!(p.text, "截线 z=x²+1：x ≈ 1，y ≈ 2");
        // Hidden curves are skipped; out-of-range values do not read.
        assert_eq!(probe(&node, &vars, r, r, &[0], 0.6, 0.7).unwrap().index, 1);
        assert!(probe(&node, &vars, r, r, &[1], 0.9, 0.5).is_none());
        assert_eq!(readout_idle(true, true), "部分曲线已隐藏；练习前请恢复课程视图。");
    }
    #[test]
    fn ticks_and_formats_follow_the_web() {
        let t = plan_axis_ticks(Range { min: -0.75, max: 8.75 }, 236., 46., None);
        assert_eq!(t.major, vec![0., 2., 4., 6., 8.]);
        assert_eq!(t.format(2.), "2");
        let t = plan_axis_ticks(Range { min: -5., max: 5. }, 362., 46., None);
        assert_eq!(t.step, 2.);
        assert_eq!(t.minor, vec![-5., -3., -1., 1., 3., 5.]);
        assert_eq!(precision5(1.0 / 3.0), "0.33333");
        assert_eq!(format_point_label("A{coords}", 1., -0.0004), "A(1, 0)");
        let v = Variables::new();
        assert_eq!(format_linear_equation("2*x - 1", &v).as_deref(), Some("y = 2x - 1"));
        assert_eq!(format_linear_equation("x^2", &v), None);
        let f = plot_frame(404., 235., Range { min: -4., max: 4. }, Range { min: -2., max: 2. }, true);
        assert!((f.width - 2. * f.height).abs() < 1e-9);
    }
}
