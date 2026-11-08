//! Card text markup and cloze: the conformance fixtures in `tests/fixtures/markup/`, the cloze
//! API, the version 1 conversion, the escape, and the parser's totality over generated input.

use knowno_engine::{
    Block, Document, Inline, SubList, cloze_from_v1, escape_literal, parse_markup,
};
use serde_json::{Map, Value, json};

fn inlines_json(inlines: &[Inline]) -> Value {
    inlines.iter().map(inline_json).collect()
}

fn inline_json(inline: &Inline) -> Value {
    match inline {
        Inline::Text(text) => json!({"type": "text", "text": text}),
        Inline::LineBreak => json!({"type": "lineBreak"}),
        Inline::Bold(content) => json!({"type": "bold", "content": inlines_json(content)}),
        Inline::Italic(content) => json!({"type": "italic", "content": inlines_json(content)}),
        Inline::Code(text) => json!({"type": "code", "text": text}),
        Inline::Cloze(cloze) => json!({
            "type": "cloze",
            "number": cloze.number,
            "answer": inlines_json(&cloze.answer),
            "hint": cloze.hint,
        }),
        Inline::Blank { hint } => json!({"type": "blank", "hint": hint}),
    }
}

fn sublist_json(sublist: &SubList) -> Value {
    json!({
        "ordered": sublist.ordered,
        "items": sublist.items.iter().map(|line| inlines_json(line)).collect::<Vec<_>>(),
    })
}

fn document_json(document: &Document) -> Value {
    document
        .blocks
        .iter()
        .map(|block| match block {
            Block::Paragraph(content) => {
                json!({"type": "paragraph", "content": inlines_json(content)})
            }
            Block::List(list) => json!({
                "type": "list",
                "ordered": list.ordered,
                "items": list.items.iter().map(|item| json!({
                    "content": inlines_json(&item.content),
                    "sublists": item.sublists.iter().map(sublist_json).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            }),
        })
        .collect()
}

fn fixture(file: &str) -> Vec<Value> {
    let path = format!(
        "{}/tests/fixtures/markup/{file}",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).expect("the fixture file is readable");
    let cases: Vec<Value> = serde_json::from_str(&text).expect("the fixture file is JSON");
    let mut names: Vec<&str> = cases
        .iter()
        .map(|case| case["name"].as_str().expect("a name"))
        .collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(
        names.len(),
        cases.len(),
        "{file}: every case has its own name"
    );
    cases
}

fn str_of<'a>(case: &'a Value, key: &str) -> &'a str {
    case[key]
        .as_str()
        .unwrap_or_else(|| panic!("{}: `{key}` is a string", case["name"]))
}

#[test]
fn every_parse_fixture_reads_as_its_document() {
    let cases = fixture("parse.json");
    assert!(
        cases.len() > 50,
        "the fixtures hold the cases the test claims to run"
    );
    for case in &cases {
        let document = document_json(&parse_markup(str_of(case, "input")));
        assert_eq!(document, case["document"], "{}", case["name"]);
    }
}

#[test]
fn every_cloze_fixture_reads_as_its_numbers_hidden_texts_and_filled_text() {
    for case in &fixture("cloze.json") {
        let document = parse_markup(str_of(case, "input"));
        let numbers = document.cloze_numbers();
        assert_eq!(json!(numbers), case["numbers"], "{}: numbers", case["name"]);
        let mut hidden = Map::new();
        for number in numbers {
            hidden.insert(number.to_string(), document_json(&document.hidden(number)));
        }
        assert_eq!(
            Value::Object(hidden),
            case["hidden"],
            "{}: hidden",
            case["name"]
        );
        assert_eq!(
            document_json(&document.filled()),
            case["filled"],
            "{}: filled",
            case["name"]
        );
    }
}

#[test]
fn every_plain_text_fixture_reads_as_its_card_key_text() {
    for case in &fixture("plain.json") {
        let plain = parse_markup(str_of(case, "input")).plain_text();
        assert_eq!(plain, str_of(case, "plainText"), "{}", case["name"]);
    }
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// The version 1 text with blank `hidden` kept and every other blank its answer; none hidden
/// when `hidden` is zero.
fn v1_with_blank(text: &str, answers: &[&str], hidden: usize) -> String {
    let mut out = String::new();
    for (index, part) in normalize_newlines(text).split("___").enumerate() {
        out.push_str(part);
        if let Some(answer) = answers.get(index) {
            if index + 1 == hidden {
                out.push_str("___");
            } else {
                out.push_str(&normalize_newlines(answer));
            }
        }
    }
    out
}

#[test]
fn every_version_1_fixture_converts_and_reads_back_or_is_refused_when_malformed() {
    let (mut converted, mut refused) = (0, 0);
    for case in &fixture("v1.json") {
        let text = str_of(case, "text");
        let answers: Vec<&str> = case["answers"]
            .as_array()
            .expect("answers")
            .iter()
            .map(|answer| answer.as_str().expect("an answer"))
            .collect();
        let got = cloze_from_v1(text, &answers);
        assert_eq!(got.as_deref(), case["source"].as_str(), "{}", case["name"]);
        let Some(source) = got else {
            refused += 1;
            continue;
        };
        converted += 1;
        let document = parse_markup(&source);
        let numbers: Vec<u32> = (1..=answers.len())
            .map(|n| u32::try_from(n).expect("small"))
            .collect();
        assert_eq!(document.cloze_numbers(), numbers, "{}", case["name"]);
        assert_eq!(
            document.plain_text(),
            v1_with_blank(text, &answers, 0),
            "{}: filled",
            case["name"]
        );
        for blank in 1..=answers.len() {
            let number = u32::try_from(blank).expect("small");
            assert_eq!(
                document.hidden(number).plain_text(),
                v1_with_blank(text, &answers, blank),
                "{}: blank {blank} hidden",
                case["name"]
            );
        }
    }
    assert!(
        converted >= 20 && refused >= 5,
        "converted {converted}, refused {refused}"
    );
}

#[test]
fn only_a_malformed_version_1_block_is_refused() {
    assert_eq!(cloze_from_v1("a ___", &[]), None);
    assert_eq!(cloze_from_v1("a ___ ___", &["b"]), None);
    assert_eq!(cloze_from_v1("a ___", &[""]), None);
    assert_eq!(cloze_from_v1("a ___", &["x\n \ny"]), None);
    // Control: the same text with a well-formed answer converts.
    assert_eq!(
        cloze_from_v1("a ___", &["x\ny"]).as_deref(),
        Some("a {{c1::x\ny}}")
    );
}

/// A deterministic stream of numbers (xorshift64).
struct Stream(u64);

impl Stream {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn generated(stream: &mut Stream, pieces: &[&str], most: u64) -> String {
    let length = stream.next() % most;
    (0..length)
        .map(|_| pieces[usize::try_from(stream.next()).expect("fits") % pieces.len()])
        .collect()
}

fn no_adjacent_text(inlines: &[Inline]) -> bool {
    inlines
        .windows(2)
        .all(|pair| !matches!(pair, [Inline::Text(_), Inline::Text(_)]))
        && inlines.iter().all(|inline| match inline {
            Inline::Bold(content) | Inline::Italic(content) => no_adjacent_text(content),
            Inline::Cloze(cloze) => no_adjacent_text(&cloze.answer),
            _ => true,
        })
}

const PIECES: &[&str] = &[
    "*", "**", "_", "`", "{{c1::", "{{c2::", "}}", "::", "{{", "}", ":", "\n", "\n\n", "- ", "1. ",
    "  - ", "\t", " ", "a", "b", "가", "😀", "\r", "\\", "#", "[", "_",
];

#[test]
fn any_generated_text_parses_and_keeps_the_cloze_api_consistent() {
    let mut stream = Stream(0x9E37_79B9_7F4A_7C15);
    let mut clozed = 0;
    for _ in 0..20_000 {
        let text = generated(&mut stream, PIECES, 24);
        let document = parse_markup(&text);
        let filled = document.filled();
        assert!(
            filled.cloze_numbers().is_empty(),
            "{text:?}: filled holds a cloze"
        );
        assert_eq!(filled.plain_text(), document.plain_text(), "{text:?}");
        for number in document.cloze_numbers() {
            clozed += 1;
            assert!(number >= 1, "{text:?}");
            assert!(
                document.hidden(number).cloze_numbers().is_empty(),
                "{text:?}"
            );
        }
        for block in &document.blocks {
            if let Block::Paragraph(content) = block {
                assert!(no_adjacent_text(content), "{text:?}");
            }
        }
    }
    assert!(clozed > 100, "the generator reached {clozed} clozes");
}

#[test]
fn a_long_text_of_unclosed_marks_is_parsed() {
    for unit in ["*a", "_a", "**a", "`a", "{{c1::a", "- a\n  - "] {
        let text = unit.repeat(3_000);
        let document = parse_markup(&text);
        assert!(!document.blocks.is_empty(), "{unit:?}");
    }
    // Control: closed, the same units are marks.
    assert!(matches!(
        parse_markup("*a*").blocks.as_slice(),
        [Block::Paragraph(content)] if matches!(content.as_slice(), [Inline::Italic(_)])
    ));
}

/// Whether the document holds only literal text, one paragraph per line.
fn is_literal(document: &Document) -> bool {
    document.blocks.iter().all(|block| match block {
        Block::Paragraph(content) => content
            .iter()
            .all(|inline| matches!(inline, Inline::Text(_) | Inline::LineBreak)),
        Block::List(_) => false,
    })
}

/// Every piece the syntax gives meaning to, and the line starts and whitespace it reads.
const DENSE_PIECES: &[&str] = &[
    "*", "**", "_", "`", "{{c1::", "}}", "{", "}", "::", ":", "\\", "\\\\", "\\*", "\n", "\n\n",
    "\r\n", "\r", "- ", "-", "1.", "1. ", "12", ".", " ", "  ", "\t", "\u{a0}", "\u{2028}", "a",
    "b", "가", "😀", "#", "[", "]",
];

#[test]
fn every_escape_fixture_is_written_as_its_markup_and_reads_back_as_the_text() {
    let cases = fixture("escape.json");
    assert!(cases.len() >= 20);
    for case in &cases {
        let text = str_of(case, "text");
        let escaped = escape_literal(text);
        assert_eq!(escaped, str_of(case, "escaped"), "{}", case["name"]);
        let document = parse_markup(&escaped);
        assert_eq!(
            document.plain_text(),
            normalize_newlines(text),
            "{}",
            case["name"]
        );
        assert!(is_literal(&document), "{}", case["name"]);
    }
}

#[test]
fn any_generated_text_escaped_reads_back_as_itself_with_no_mark_or_cloze() {
    let mut stream = Stream(0xD1B5_4A32_D192_ED03);
    let mut lines = 0;
    for _ in 0..20_000 {
        let text = generated(&mut stream, DENSE_PIECES, 30);
        let document = parse_markup(&escape_literal(&text));
        assert_eq!(document.plain_text(), normalize_newlines(&text), "{text:?}");
        assert!(is_literal(&document), "{text:?}");
        assert!(document.cloze_numbers().is_empty(), "{text:?}");
        lines += text.matches('\n').count();
    }
    assert!(lines > 10_000, "the generator reached {lines} newlines");
    // Control: unescaped, the same kind of text is read as markup.
    assert!(!is_literal(&parse_markup("*a*\n- b")));
}

#[test]
fn any_generated_version_1_block_converts_and_reads_back() {
    const ANSWERS: &[&str] = &[
        "*", "_", "`", "{{c1::", "}}", "::", ":", "\\", "\n", "\r\n", "- ", "1. ", " ", "a", "b",
        "가",
    ];
    let mut stream = Stream(0x2545_F491_4F6C_DD1D);
    let mut converted = 0;
    for _ in 0..10_000 {
        let blanks = usize::try_from(stream.next() % 4).expect("small");
        let answers: Vec<String> = (0..blanks)
            .map(|_| format!("x{}", generated(&mut stream, ANSWERS, 8)))
            .collect();
        let mut text = generated(&mut stream, DENSE_PIECES, 6);
        for _ in 0..blanks {
            text.push_str("___");
            text.push_str(&generated(&mut stream, DENSE_PIECES, 6));
        }

        let borrowed: Vec<&str> = answers.iter().map(String::as_str).collect();
        let clean = answers.iter().all(|answer| {
            normalize_newlines(answer)
                .split('\n')
                .all(|l| !l.trim().is_empty())
        });
        let got = cloze_from_v1(&text, &borrowed);
        if text.matches("___").count() != blanks || !clean {
            continue;
        }
        let source = got.unwrap_or_else(|| panic!("{text:?} {answers:?}: refused"));
        converted += 1;
        let document = parse_markup(&source);
        let numbers: Vec<u32> = (1..=blanks)
            .map(|n| u32::try_from(n).expect("small"))
            .collect();
        assert_eq!(document.cloze_numbers(), numbers, "{text:?} {answers:?}");
        assert_eq!(
            document.plain_text(),
            v1_with_blank(&text, &borrowed, 0),
            "{text:?} {answers:?}"
        );
        for blank in 1..=blanks {
            let number = u32::try_from(blank).expect("small");
            assert_eq!(
                document.hidden(number).plain_text(),
                v1_with_blank(&text, &borrowed, blank),
                "{text:?} {answers:?}: blank {blank}"
            );
        }
    }
    assert!(
        converted > 2_000,
        "the generator reached {converted} blocks"
    );
}
