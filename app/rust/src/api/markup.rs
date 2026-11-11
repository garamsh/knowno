//! The card text parser the app calls through the bridge: a Markdown subset and Anki's cloze
//! syntax, read by the engine's one parser (`docs/architecture/engine.md` §Card text markup).
//!
//! Every function is total: no text is refused, and nothing here panics across the bridge. The
//! types mirror the engine's document, which `engine/tests/fixtures/markup/` pins.

#![deny(
    missing_docs,
    clippy::panic,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing
)]

use knowno_engine as engine;

/// A block of a parsed text.
pub enum MarkupBlock {
    /// Lines of text up to a blank line or a list.
    Paragraph {
        /// The paragraph's text and marks.
        content: Vec<MarkupInline>,
    },
    /// A run of list items of one kind.
    List {
        /// Numbered, counted from 1, rather than bulleted.
        ordered: bool,
        /// The items, at least one.
        items: Vec<MarkupListItem>,
    },
}

/// An item of a list, with the lists nested under it.
pub struct MarkupListItem {
    /// The item's line.
    pub content: Vec<MarkupInline>,
    /// The indented lists under the item.
    pub sublists: Vec<MarkupSubList>,
}

/// A list one level down.
pub struct MarkupSubList {
    /// Numbered, counted from 1, rather than bulleted.
    pub ordered: bool,
    /// The items' lines, at least one.
    pub items: Vec<Vec<MarkupInline>>,
}

/// Text inside a block.
pub enum MarkupInline {
    /// Literal text.
    Text {
        /// The text.
        text: String,
    },
    /// A newline inside a paragraph.
    LineBreak,
    /// `**…**`.
    Bold {
        /// What is bold.
        content: Vec<MarkupInline>,
    },
    /// `*…*` or `_…_`.
    Italic {
        /// What is italic.
        content: Vec<MarkupInline>,
    },
    /// `` `…` ``.
    Code {
        /// The code's literal text.
        text: String,
    },
    /// `{{cN::answer}}` or `{{cN::answer::hint}}`.
    Cloze {
        /// The cloze number, from 1.
        number: u32,
        /// The answer.
        answer: Vec<MarkupInline>,
        /// The hint, absent when none.
        hint: Option<String>,
    },
    /// A cloze hidden by [`hide_cloze`].
    Blank {
        /// The hidden cloze's hint.
        hint: Option<String>,
    },
}

/// Parses `text` into its blocks.
#[flutter_rust_bridge::frb(sync)]
pub fn parse_markup(text: String) -> Vec<MarkupBlock> {
    blocks(&engine::parse_markup(&text))
}

/// `text` with every span of cloze `number` a blank carrying its hint and every other cloze
/// shown as its answer.
#[flutter_rust_bridge::frb(sync)]
pub fn hide_cloze(text: String, number: u32) -> Vec<MarkupBlock> {
    blocks(&engine::parse_markup(&text).hidden(number))
}

/// `text` with every cloze shown as its answer.
#[flutter_rust_bridge::frb(sync)]
pub fn fill_cloze(text: String) -> Vec<MarkupBlock> {
    blocks(&engine::parse_markup(&text).filled())
}

/// The cloze numbers `text` holds, ascending, each once.
#[flutter_rust_bridge::frb(sync)]
pub fn cloze_numbers(text: String) -> Vec<u32> {
    engine::parse_markup(&text).cloze_numbers()
}

/// The text a card key is made of: marks removed, clozes filled.
#[flutter_rust_bridge::frb(sync)]
pub fn plain_text(text: String) -> String {
    engine::parse_markup(&text).plain_text()
}

/// `text` written as markup that reads back as itself: the text of a literal 글 or cloze that
/// is saved as markup keeps its meaning.
#[flutter_rust_bridge::frb(sync)]
pub fn escape_literal(text: String) -> String {
    engine::escape_literal(&text)
}

fn blocks(document: &engine::Document) -> Vec<MarkupBlock> {
    document.blocks.iter().map(MarkupBlock::from).collect()
}

fn inlines(content: &[engine::Inline]) -> Vec<MarkupInline> {
    content.iter().map(MarkupInline::from).collect()
}

impl From<&engine::Block> for MarkupBlock {
    fn from(block: &engine::Block) -> Self {
        match block {
            engine::Block::Paragraph(content) => MarkupBlock::Paragraph {
                content: inlines(content),
            },
            engine::Block::List(list) => MarkupBlock::List {
                ordered: list.ordered,
                items: list
                    .items
                    .iter()
                    .map(|item| MarkupListItem {
                        content: inlines(&item.content),
                        sublists: item
                            .sublists
                            .iter()
                            .map(|sublist| MarkupSubList {
                                ordered: sublist.ordered,
                                items: sublist.items.iter().map(|line| inlines(line)).collect(),
                            })
                            .collect(),
                    })
                    .collect(),
            },
        }
    }
}

impl From<&engine::Inline> for MarkupInline {
    fn from(inline: &engine::Inline) -> Self {
        match inline {
            engine::Inline::Text(text) => MarkupInline::Text { text: text.clone() },
            engine::Inline::LineBreak => MarkupInline::LineBreak,
            engine::Inline::Bold(content) => MarkupInline::Bold {
                content: inlines(content),
            },
            engine::Inline::Italic(content) => MarkupInline::Italic {
                content: inlines(content),
            },
            engine::Inline::Code(text) => MarkupInline::Code { text: text.clone() },
            engine::Inline::Cloze(cloze) => MarkupInline::Cloze {
                number: cloze.number,
                answer: inlines(&cloze.answer),
                hint: cloze.hint.clone(),
            },
            engine::Inline::Blank { hint } => MarkupInline::Blank { hint: hint.clone() },
        }
    }
}
