//! The markup and cloze operations reach JavaScript as the conformance fixtures of
//! `engine/tests/fixtures/markup/` say, `null` hints included.

use knowno_engine_wasm::Block;
use knowno_engine_wasm::{
    cloze_numbers, escape_literal, fill_cloze, hide_cloze, parse_markup, plain_text,
};
use serde_json::Value;
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::wasm_bindgen_test;

const PARSE: &str = include_str!("../../engine/tests/fixtures/markup/parse.json");
const CLOZE: &str = include_str!("../../engine/tests/fixtures/markup/cloze.json");
const PLAIN: &str = include_str!("../../engine/tests/fixtures/markup/plain.json");
const ESCAPE: &str = include_str!("../../engine/tests/fixtures/markup/escape.json");

#[wasm_bindgen(inline_js = r#"
export function stringify(value) {
  return JSON.stringify(value);
}
"#)]
extern "C" {
    /// Reads a returned value as JavaScript sees it, `undefined` fields left out.
    fn stringify(value: JsValue) -> String;
}

fn cases(file: &str) -> Vec<Value> {
    serde_json::from_str(file).expect("the fixture is JSON")
}

fn seen(blocks: Vec<Ts<Block>>) -> Value {
    let blocks: Vec<Value> = blocks
        .into_iter()
        .map(|block| serde_json::from_str(&stringify(block.into())).expect("JSON"))
        .collect();
    Value::Array(blocks)
}

fn text(case: &Value, key: &str) -> String {
    case[key].as_str().expect("a string").to_owned()
}

#[wasm_bindgen_test]
fn parse_markup_returns_each_fixture_s_document() {
    let cases = cases(PARSE);
    assert!(cases.len() > 50);
    for case in &cases {
        let got = seen(parse_markup(&text(case, "input")).expect("parsed"));
        assert_eq!(got, case["document"], "{}", case["name"]);
    }
}

#[wasm_bindgen_test]
fn the_cloze_operations_return_each_fixture_s_numbers_hidden_and_filled_texts() {
    let mut holding = 0;
    for case in &cases(CLOZE) {
        let input = text(case, "input");
        let numbers = cloze_numbers(&input);
        assert_eq!(
            serde_json::json!(numbers),
            case["numbers"],
            "{}",
            case["name"]
        );
        for number in numbers {
            holding += 1;
            let hidden = seen(hide_cloze(&input, number).expect("hidden"));
            assert_eq!(
                hidden,
                case["hidden"][number.to_string()],
                "{}",
                case["name"]
            );
        }
        let filled = seen(fill_cloze(&input).expect("filled"));
        assert_eq!(filled, case["filled"], "{}", case["name"]);
    }
    assert!(holding > 10);
}

#[wasm_bindgen_test]
fn plain_text_returns_each_fixture_s_card_key_text() {
    for case in &cases(PLAIN) {
        assert_eq!(
            plain_text(&text(case, "input")),
            text(case, "plainText"),
            "{}",
            case["name"]
        );
    }
}

#[wasm_bindgen_test]
fn escape_literal_returns_each_fixture_s_markup() {
    let cases = cases(ESCAPE);
    assert!(cases.len() >= 20);
    for case in &cases {
        assert_eq!(
            escape_literal(&text(case, "text")),
            text(case, "escaped"),
            "{}",
            case["name"]
        );
    }
}
