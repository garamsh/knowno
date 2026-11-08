//! The markup and cloze operations reach JavaScript as the conformance fixtures of
//! `engine/tests/fixtures/markup/` say, `null` hints included.

use knowno_engine_wasm::Block;
use knowno_engine_wasm::{
    cloze_from_v1, cloze_numbers, fill_cloze, hide_cloze, parse_markup, plain_text,
};
use serde_json::Value;
use tsify::Ts;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::wasm_bindgen_test;

const PARSE: &str = include_str!("../../engine/tests/fixtures/markup/parse.json");
const CLOZE: &str = include_str!("../../engine/tests/fixtures/markup/cloze.json");
const PLAIN: &str = include_str!("../../engine/tests/fixtures/markup/plain.json");
const V1: &str = include_str!("../../engine/tests/fixtures/markup/v1.json");

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
fn cloze_from_v1_returns_each_fixture_s_source_or_nothing() {
    let (mut converted, mut refused) = (0, 0);
    for case in &cases(V1) {
        let answers = case["answers"]
            .as_array()
            .expect("answers")
            .iter()
            .map(|answer| answer.as_str().expect("an answer").to_owned())
            .collect();
        let got = cloze_from_v1(&text(case, "text"), answers);
        assert_eq!(got.as_deref(), case["source"].as_str(), "{}", case["name"]);
        if got.is_some() {
            converted += 1;
        } else {
            refused += 1;
        }
    }
    assert!(converted >= 8 && refused >= 8);
}
