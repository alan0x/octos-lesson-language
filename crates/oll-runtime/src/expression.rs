//! Numeric expression semantics ported from packages/core/src/math-expression.ts.
use std::collections::BTreeMap;
pub type Variables = BTreeMap<String, f64>;

pub fn evaluate(expression: &str, variables: &Variables) -> Result<f64, String> {
    let normalized = expression
        .trim()
        .replace('π', "pi")
        .replace('−', "-")
        .replace('×', "*")
        .replace('÷', "/");
    if normalized.is_empty() || normalized.encode_utf16().count() > 256 {
        return Err("Expression must contain 1..256 UTF-16 code units".into());
    }
    let mut p = Parser {
        input: normalized.chars().collect(),
        cursor: 0,
        variables,
    };
    let result = p.sum()?;
    p.space();
    if p.cursor != p.input.len() {
        return Err("Unexpected trailing token".into());
    }
    if !result.is_finite() {
        return Err("Expression result is not finite".into());
    }
    Ok(result)
}
struct Parser<'a> {
    input: Vec<char>,
    cursor: usize,
    variables: &'a Variables,
}
impl Parser<'_> {
    fn space(&mut self) {
        while self
            .input
            .get(self.cursor)
            .is_some_and(|c| c.is_whitespace() || *c == '\u{feff}')
        {
            self.cursor += 1;
        }
    }
    fn take(&mut self, c: char) -> bool {
        self.space();
        if self.input.get(self.cursor) == Some(&c) {
            self.cursor += 1;
            true
        } else {
            false
        }
    }
    fn require(&mut self, c: char) -> Result<(), String> {
        if self.take(c) {
            Ok(())
        } else {
            Err(format!("Expected '{c}'"))
        }
    }
    fn sum(&mut self) -> Result<f64, String> {
        let mut v = self.product()?;
        loop {
            if self.take('+') {
                v += self.product()?;
            } else if self.take('-') {
                v -= self.product()?;
            } else {
                return Ok(v);
            }
        }
    }
    fn product(&mut self) -> Result<f64, String> {
        let mut v = self.unary()?;
        loop {
            if self.take('*') {
                v *= self.unary()?;
            } else if self.take('/') {
                v /= self.unary()?;
            } else {
                return Ok(v);
            }
        }
    }
    fn unary(&mut self) -> Result<f64, String> {
        if self.take('+') {
            self.unary()
        } else if self.take('-') {
            Ok(-self.unary()?)
        } else {
            self.power()
        }
    }
    fn power(&mut self) -> Result<f64, String> {
        let v = self.primary()?;
        if self.take('^') {
            Ok(v.powf(self.unary()?))
        } else {
            Ok(v)
        }
    }
    fn primary(&mut self) -> Result<f64, String> {
        if self.take('(') {
            let v = self.sum()?;
            self.require(')')?;
            return Ok(v);
        }
        self.space();
        let start = self.cursor;
        match self.input.get(start) {
            Some(c) if c.is_ascii_digit() || *c == '.' => {
                while self
                    .input
                    .get(self.cursor)
                    .is_some_and(char::is_ascii_digit)
                {
                    self.cursor += 1;
                }
                if self.input.get(self.cursor) == Some(&'.') {
                    self.cursor += 1;
                    while self
                        .input
                        .get(self.cursor)
                        .is_some_and(char::is_ascii_digit)
                    {
                        self.cursor += 1;
                    }
                }
                if self
                    .input
                    .get(self.cursor)
                    .is_some_and(|c| *c == 'e' || *c == 'E')
                {
                    self.cursor += 1;
                    if self
                        .input
                        .get(self.cursor)
                        .is_some_and(|c| *c == '+' || *c == '-')
                    {
                        self.cursor += 1;
                    }
                    while self
                        .input
                        .get(self.cursor)
                        .is_some_and(char::is_ascii_digit)
                    {
                        self.cursor += 1;
                    }
                }
                self.input[start..self.cursor]
                    .iter()
                    .collect::<String>()
                    .parse()
                    .map_err(|_| "Invalid number".into())
            }
            Some(c) if c.is_ascii_alphabetic() => {
                self.cursor += 1;
                while self
                    .input
                    .get(self.cursor)
                    .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_')
                {
                    self.cursor += 1;
                }
                let id = self.input[start..self.cursor]
                    .iter()
                    .collect::<String>()
                    .to_ascii_lowercase();
                if id == "pi" {
                    return Ok(std::f64::consts::PI);
                }
                if id == "e" {
                    return Ok(std::f64::consts::E);
                }
                if let Some(v) = self.variables.get(&id) {
                    return if v.is_finite() {
                        Ok(*v)
                    } else {
                        Err(format!("Variable '{id}' has no finite value"))
                    };
                }
                self.require('(')?;
                let v = self.sum()?;
                self.require(')')?;
                Ok(match id.as_str() {
                    "abs" => v.abs(),
                    "acos" => v.acos(),
                    "asin" => v.asin(),
                    "atan" => v.atan(),
                    "ceil" => v.ceil(),
                    "cos" => v.cos(),
                    "exp" => v.exp(),
                    "floor" => v.floor(),
                    "ln" | "log" => v.ln(),
                    "sin" => v.sin(),
                    "sqrt" => v.sqrt(),
                    "tan" => v.tan(),
                    // JavaScript rounds ties towards +infinity and preserves negative zero.
                    "round" => {
                        if (-0.5..0.0).contains(&v) {
                            -0.0
                        } else if v.fract() == 0.0 {
                            v
                        } else {
                            let floor = v.floor();
                            if v - floor < 0.5 {
                                floor
                            } else {
                                floor + 1.0
                            }
                        }
                    }
                    _ => return Err(format!("Unknown variable or function '{id}'")),
                })
            }
            _ => Err("Expected a number, variable, or function".into()),
        }
    }
}
