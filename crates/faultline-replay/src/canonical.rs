use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use unicode_normalization::UnicodeNormalization;

use crate::Error;

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CanonicalValue {
    Null,
    Bool(bool),
    Integer(i64),
    String(String),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}

pub fn parse(bytes: &[u8]) -> Result<CanonicalValue, Error> {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(Error::Canonical("UTF-8 BOM is forbidden".into()));
    }
    if bytes.contains(&0) {
        return Err(Error::Canonical("NUL is forbidden".into()));
    }
    let input = std::str::from_utf8(bytes)
        .map_err(|_| Error::Canonical("input is not valid UTF-8".into()))?;
    let mut parser = Parser { input, pos: 0 };
    let value = parser.value()?;
    parser.whitespace();
    if parser.pos != input.len() {
        return Err(Error::Canonical("trailing JSON content".into()));
    }
    Ok(value)
}

pub fn parse_typed<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, Error> {
    let value = parse(bytes)?;
    serde_json::from_value(value.to_serde()).map_err(Error::Schema)
}

pub fn serialize(value: &CanonicalValue) -> Vec<u8> {
    let mut output = String::new();
    value.write(&mut output);
    output.into_bytes()
}

pub fn serialize_typed<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, Error> {
    let value = serde_json::to_value(value).map_err(Error::Schema)?;
    let canonical = CanonicalValue::from_serde(value)?;
    Ok(serialize(&canonical))
}

impl CanonicalValue {
    pub fn to_serde(&self) -> serde_json::Value {
        match self {
            Self::Null => serde_json::Value::Null,
            Self::Bool(value) => serde_json::Value::Bool(*value),
            Self::Integer(value) => serde_json::Value::Number((*value).into()),
            Self::String(value) => serde_json::Value::String(value.clone()),
            Self::Array(values) => {
                serde_json::Value::Array(values.iter().map(Self::to_serde).collect())
            }
            Self::Object(values) => serde_json::Value::Object(
                values
                    .iter()
                    .map(|(key, value)| (key.clone(), value.to_serde()))
                    .collect(),
            ),
        }
    }

    fn from_serde(value: serde_json::Value) -> Result<Self, Error> {
        Ok(match value {
            serde_json::Value::Null => Self::Null,
            serde_json::Value::Bool(value) => Self::Bool(value),
            serde_json::Value::Number(value) => {
                let integer = value.as_i64().ok_or_else(|| {
                    Error::Canonical("floating point and oversized integers are forbidden".into())
                })?;
                if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&integer) {
                    return Err(Error::Canonical(
                        "integer exceeds interoperable range".into(),
                    ));
                }
                Self::Integer(integer)
            }
            serde_json::Value::String(value) => {
                require_nfc(&value)?;
                Self::String(value)
            }
            serde_json::Value::Array(values) => Self::Array(
                values
                    .into_iter()
                    .map(Self::from_serde)
                    .collect::<Result<_, _>>()?,
            ),
            serde_json::Value::Object(values) => {
                let mut result = BTreeMap::new();
                for (key, value) in values {
                    require_nfc(&key)?;
                    result.insert(key, Self::from_serde(value)?);
                }
                Self::Object(result)
            }
        })
    }

    fn write(&self, output: &mut String) {
        match self {
            Self::Null => output.push_str("null"),
            Self::Bool(false) => output.push_str("false"),
            Self::Bool(true) => output.push_str("true"),
            Self::Integer(value) => output.push_str(&value.to_string()),
            Self::String(value) => write_string(value, output),
            Self::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index != 0 {
                        output.push(',');
                    }
                    value.write(output);
                }
                output.push(']');
            }
            Self::Object(values) => {
                output.push('{');
                for (index, (key, value)) in values.iter().enumerate() {
                    if index != 0 {
                        output.push(',');
                    }
                    write_string(key, output);
                    output.push(':');
                    value.write(output);
                }
                output.push('}');
            }
        }
    }
}

fn write_string(value: &str, output: &mut String) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{0008}' => output.push_str("\\b"),
            '\t' => output.push_str("\\t"),
            '\n' => output.push_str("\\n"),
            '\u{000c}' => output.push_str("\\f"),
            '\r' => output.push_str("\\r"),
            c if c <= '\u{001f}' => {
                use std::fmt::Write;
                write!(output, "\\u{:04x}", c as u32).expect("writing to String cannot fail");
            }
            c => output.push(c),
        }
    }
    output.push('"');
}

fn require_nfc(value: &str) -> Result<(), Error> {
    if value.nfc().eq(value.chars()) {
        Ok(())
    } else {
        Err(Error::Canonical("string is not Unicode NFC".into()))
    }
}

struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn value(&mut self) -> Result<CanonicalValue, Error> {
        self.whitespace();
        match self.peek() {
            Some(b'n') => {
                self.literal("null")?;
                Ok(CanonicalValue::Null)
            }
            Some(b'f') => {
                self.literal("false")?;
                Ok(CanonicalValue::Bool(false))
            }
            Some(b't') => {
                self.literal("true")?;
                Ok(CanonicalValue::Bool(true))
            }
            Some(b'"') => Ok(CanonicalValue::String(self.string()?)),
            Some(b'[') => self.array(),
            Some(b'{') => self.object(),
            Some(b'-' | b'0'..=b'9') => self.integer(),
            _ => Err(Error::Canonical("expected JSON value".into())),
        }
    }

    fn array(&mut self) -> Result<CanonicalValue, Error> {
        self.pos += 1;
        let mut values = Vec::new();
        self.whitespace();
        if self.take(b']') {
            return Ok(CanonicalValue::Array(values));
        }
        loop {
            values.push(self.value()?);
            self.whitespace();
            if self.take(b']') {
                break;
            }
            self.expect(b',')?;
        }
        Ok(CanonicalValue::Array(values))
    }

    fn object(&mut self) -> Result<CanonicalValue, Error> {
        self.pos += 1;
        let mut values = BTreeMap::new();
        self.whitespace();
        if self.take(b'}') {
            return Ok(CanonicalValue::Object(values));
        }
        loop {
            self.whitespace();
            let key = self.string()?;
            self.whitespace();
            self.expect(b':')?;
            let value = self.value()?;
            if values.insert(key.clone(), value).is_some() {
                return Err(Error::DuplicateKey(key));
            }
            self.whitespace();
            if self.take(b'}') {
                break;
            }
            self.expect(b',')?;
        }
        Ok(CanonicalValue::Object(values))
    }

    fn integer(&mut self) -> Result<CanonicalValue, Error> {
        let start = self.pos;
        if self.take(b'-') {
            if self.peek() == Some(b'0') {
                return Err(Error::Canonical("negative zero is forbidden".into()));
            }
        }
        match self.peek() {
            Some(b'0') => {
                self.pos += 1;
                if matches!(self.peek(), Some(b'0'..=b'9')) {
                    return Err(Error::Canonical("leading zero is forbidden".into()));
                }
            }
            Some(b'1'..=b'9') => {
                self.pos += 1;
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(Error::Canonical("invalid integer".into())),
        }
        if matches!(self.peek(), Some(b'.' | b'e' | b'E' | b'+')) {
            return Err(Error::Canonical(
                "floating point numbers are forbidden".into(),
            ));
        }
        let text = &self.input[start..self.pos];
        let value = text
            .parse::<i64>()
            .map_err(|_| Error::Canonical("invalid integer".into()))?;
        if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
            return Err(Error::Canonical(
                "integer exceeds interoperable range".into(),
            ));
        }
        Ok(CanonicalValue::Integer(value))
    }

    fn string(&mut self) -> Result<String, Error> {
        self.expect(b'"')?;
        let mut output = String::new();
        loop {
            let byte = self
                .peek()
                .ok_or_else(|| Error::Canonical("unterminated string".into()))?;
            if byte == b'"' {
                self.pos += 1;
                require_nfc(&output)?;
                return Ok(output);
            }
            if byte == b'\\' {
                self.pos += 1;
                let escaped = self
                    .peek()
                    .ok_or_else(|| Error::Canonical("unterminated escape".into()))?;
                self.pos += 1;
                match escaped {
                    b'"' => output.push('"'),
                    b'\\' => output.push('\\'),
                    b'/' => output.push('/'),
                    b'b' => output.push('\u{0008}'),
                    b'f' => output.push('\u{000c}'),
                    b'n' => output.push('\n'),
                    b'r' => output.push('\r'),
                    b't' => output.push('\t'),
                    b'u' => output.push(self.unicode_escape()?),
                    _ => return Err(Error::Canonical("invalid string escape".into())),
                }
                continue;
            }
            let character = self.input[self.pos..]
                .chars()
                .next()
                .expect("peek proved input remains");
            if character <= '\u{001f}' {
                return Err(Error::Canonical("unescaped control character".into()));
            }
            output.push(character);
            self.pos += character.len_utf8();
        }
    }

    fn unicode_escape(&mut self) -> Result<char, Error> {
        let first = self.hex4()?;
        let scalar = if (0xd800..=0xdbff).contains(&first) {
            self.expect(b'\\')?;
            self.expect(b'u')?;
            let second = self.hex4()?;
            if !(0xdc00..=0xdfff).contains(&second) {
                return Err(Error::Canonical("invalid UTF-16 surrogate pair".into()));
            }
            0x10000 + (((first - 0xd800) as u32) << 10) + (second - 0xdc00) as u32
        } else if (0xdc00..=0xdfff).contains(&first) {
            return Err(Error::Canonical("unpaired UTF-16 surrogate".into()));
        } else {
            first as u32
        };
        char::from_u32(scalar).ok_or_else(|| Error::Canonical("invalid Unicode scalar".into()))
    }

    fn hex4(&mut self) -> Result<u16, Error> {
        let mut value = 0_u16;
        for _ in 0..4 {
            let digit = self
                .peek()
                .and_then(|byte| (byte as char).to_digit(16))
                .ok_or_else(|| Error::Canonical("invalid Unicode escape".into()))?;
            self.pos += 1;
            value = (value << 4) | digit as u16;
        }
        Ok(value)
    }

    fn literal(&mut self, literal: &str) -> Result<(), Error> {
        if self.input[self.pos..].starts_with(literal) {
            self.pos += literal.len();
            Ok(())
        } else {
            Err(Error::Canonical("invalid JSON literal".into()))
        }
    }

    fn whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, expected: u8) -> Result<(), Error> {
        if self.take(expected) {
            Ok(())
        } else {
            Err(Error::Canonical(format!(
                "expected byte {:?}",
                expected as char
            )))
        }
    }

    fn take(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn peek(&self) -> Option<u8> {
        self.input.as_bytes().get(self.pos).copied()
    }
}
