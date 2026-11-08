//! Card text markup: a Markdown subset and Anki's cloze syntax, parsed into a typed document.
//!
//! The parser is total: every text yields a [`Document`], and markup it cannot close or does
//! not know is kept as literal text. `engine/tests/fixtures/markup/` holds the conformance
//! fixtures any other reader of this syntax is tested against.

use std::collections::BTreeSet;

/// The longest run of digits a cloze number may have.
const MAX_NUMBER_DIGITS: usize = 9;

/// A parsed text: blocks in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    /// The blocks, paragraphs and lists, in order.
    pub blocks: Vec<Block>,
}

/// A block of a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    /// Lines of text up to a blank line or a list; a single newline is an [`Inline::LineBreak`].
    Paragraph(Vec<Inline>),
    /// A run of list items of one kind.
    List(List),
}

/// A bulleted or numbered list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct List {
    /// Numbered, counted from 1, rather than bulleted.
    pub ordered: bool,
    /// The items, at least one.
    pub items: Vec<ListItem>,
}

/// An item of a list, with the lists nested under it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListItem {
    /// The item's line.
    pub content: Vec<Inline>,
    /// The indented lists under the item, one per change of marker kind.
    pub sublists: Vec<SubList>,
}

/// A list one level down; its items hold no list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubList {
    /// Numbered, counted from 1, rather than bulleted.
    pub ordered: bool,
    /// The items' lines, at least one.
    pub items: Vec<Vec<Inline>>,
}

/// Text inside a block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inline {
    /// Literal text, never adjacent to another `Text`.
    Text(String),
    /// A newline inside a paragraph.
    LineBreak,
    /// `**…**`.
    Bold(Vec<Inline>),
    /// `*…*` or `_…_`.
    Italic(Vec<Inline>),
    /// `` `…` ``: its text is literal.
    Code(String),
    /// `{{cN::answer}}` or `{{cN::answer::hint}}`.
    Cloze(Cloze),
    /// A cloze hidden by [`Document::hidden`]; the parser never returns one.
    Blank {
        /// The hint of the hidden cloze.
        hint: Option<String>,
    },
}

/// A cloze span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cloze {
    /// The cloze number, from 1; spans sharing it are hidden together.
    pub number: u32,
    /// The answer: text and marks, never another cloze.
    pub answer: Vec<Inline>,
    /// The hint, absent when none or empty.
    pub hint: Option<String>,
}

/// Parses `text` into a document. Total: no input is refused.
pub fn parse_markup(text: &str) -> Document {
    let text = text.replace("\r\n", "\n");
    let mut blocks = Blocks::default();
    for line in text.split('\n') {
        blocks.line(line);
    }
    blocks.finish()
}

impl Document {
    /// The cloze numbers the document holds, ascending, each once.
    pub fn cloze_numbers(&self) -> Vec<u32> {
        let mut numbers = BTreeSet::new();
        self.each_inlines(&mut |inlines| collect_numbers(inlines, &mut numbers));
        numbers.into_iter().collect()
    }

    /// The document with every span of cloze `number` a [`Inline::Blank`] carrying its hint
    /// and every other cloze shown as its answer.
    pub fn hidden(&self, number: u32) -> Document {
        self.map_clozes(&|cloze| {
            if cloze.number == number {
                vec![Inline::Blank {
                    hint: cloze.hint.clone(),
                }]
            } else {
                cloze.answer.clone()
            }
        })
    }

    /// The document with every cloze shown as its answer.
    pub fn filled(&self) -> Document {
        self.map_clozes(&|cloze| cloze.answer.clone())
    }

    /// The text without marks, clozes filled, for the card key: blocks apart by a blank line,
    /// list items and line breaks by a newline, a [`Inline::Blank`] as `___`.
    pub fn plain_text(&self) -> String {
        let blocks: Vec<String> = self
            .blocks
            .iter()
            .map(|block| match block {
                Block::Paragraph(content) => plain(content),
                Block::List(list) => {
                    let mut lines = Vec::new();
                    for item in &list.items {
                        lines.push(plain(&item.content));
                        for sublist in &item.sublists {
                            lines.extend(sublist.items.iter().map(|line| plain(line)));
                        }
                    }
                    lines.join("\n")
                }
            })
            .collect();
        blocks.join("\n\n")
    }

    fn each_inlines(&self, visit: &mut dyn FnMut(&[Inline])) {
        for block in &self.blocks {
            match block {
                Block::Paragraph(content) => visit(content),
                Block::List(list) => {
                    for item in &list.items {
                        visit(&item.content);
                        for sublist in &item.sublists {
                            sublist.items.iter().for_each(|line| visit(line));
                        }
                    }
                }
            }
        }
    }

    fn map_clozes(&self, replace: &dyn Fn(&Cloze) -> Vec<Inline>) -> Document {
        let blocks = self
            .blocks
            .iter()
            .map(|block| match block {
                Block::Paragraph(content) => Block::Paragraph(map_inlines(content, replace)),
                Block::List(list) => Block::List(List {
                    ordered: list.ordered,
                    items: list
                        .items
                        .iter()
                        .map(|item| ListItem {
                            content: map_inlines(&item.content, replace),
                            sublists: item
                                .sublists
                                .iter()
                                .map(|sublist| SubList {
                                    ordered: sublist.ordered,
                                    items: sublist
                                        .items
                                        .iter()
                                        .map(|line| map_inlines(line, replace))
                                        .collect(),
                                })
                                .collect(),
                        })
                        .collect(),
                }),
            })
            .collect();
        Document { blocks }
    }
}

/// A version 1 cloze block, its text with `___` for each blank and its answers in order, as a
/// text of this syntax: blank k becomes `{{ck::answer_k}}`.
///
/// `None` when the number of blanks differs from the number of answers, or when the result
/// would not read back as the same text with the same answers, as when an answer holds `::`
/// or `}}` or the text holds a mark: the caller keeps the version 1 block.
pub fn cloze_from_v1(text: &str, answers: &[&str]) -> Option<String> {
    let parts: Vec<&str> = text.split("___").collect();
    if parts.len() != answers.len() + 1 {
        return None;
    }
    let mut source = String::new();
    let mut filled = String::new();
    for (index, part) in parts.iter().enumerate() {
        source.push_str(part);
        filled.push_str(part);
        if let Some(answer) = answers.get(index) {
            source.push_str(&format!("{{{{c{}::{answer}}}}}", index + 1));
            filled.push_str(answer);
        }
    }
    let read_back = parse_markup(&source);
    let numbers: Vec<u32> = (1..=answers.len())
        .filter_map(|n| u32::try_from(n).ok())
        .collect();
    (read_back.cloze_numbers() == numbers && read_back.plain_text() == filled).then_some(source)
}

fn plain(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|inline| match inline {
            Inline::Text(text) | Inline::Code(text) => text.clone(),
            Inline::LineBreak => "\n".to_owned(),
            Inline::Bold(content) | Inline::Italic(content) => plain(content),
            Inline::Cloze(cloze) => plain(&cloze.answer),
            Inline::Blank { .. } => "___".to_owned(),
        })
        .collect()
}

fn collect_numbers(inlines: &[Inline], numbers: &mut BTreeSet<u32>) {
    for inline in inlines {
        match inline {
            Inline::Cloze(cloze) => {
                numbers.insert(cloze.number);
            }
            Inline::Bold(content) | Inline::Italic(content) => collect_numbers(content, numbers),
            Inline::Text(_) | Inline::LineBreak | Inline::Code(_) | Inline::Blank { .. } => {}
        }
    }
}

fn map_inlines(inlines: &[Inline], replace: &dyn Fn(&Cloze) -> Vec<Inline>) -> Vec<Inline> {
    let mut out = Vec::new();
    for inline in inlines {
        match inline {
            Inline::Cloze(cloze) => out.extend(replace(cloze)),
            Inline::Bold(content) => out.push(Inline::Bold(map_inlines(content, replace))),
            Inline::Italic(content) => out.push(Inline::Italic(map_inlines(content, replace))),
            other => out.push(other.clone()),
        }
    }
    merge_text(out)
}

fn merge_text(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::new();
    for inline in inlines {
        match (out.last_mut(), inline) {
            (Some(Inline::Text(last)), Inline::Text(next)) => last.push_str(&next),
            (_, inline) => out.push(inline),
        }
    }
    out
}

/// Builds the blocks line by line.
#[derive(Default)]
struct Blocks {
    done: Vec<Block>,
    paragraph: Vec<String>,
    list: Option<ListBuilder>,
}

struct ListBuilder {
    ordered: bool,
    items: Vec<ListItem>,
}

/// A list marker at the start of a line.
struct Marker<'a> {
    nested: bool,
    ordered: bool,
    content: &'a str,
}

impl Blocks {
    fn line(&mut self, line: &str) {
        if line.trim().is_empty() {
            self.flush_paragraph();
            self.flush_list();
            return;
        }
        match marker(line) {
            Some(Marker {
                nested: false,
                ordered,
                content,
            }) => {
                self.flush_paragraph();
                if self
                    .list
                    .as_ref()
                    .is_some_and(|list| list.ordered != ordered)
                {
                    self.flush_list();
                }
                let list = self.list.get_or_insert_with(|| ListBuilder {
                    ordered,
                    items: Vec::new(),
                });
                list.items.push(ListItem {
                    content: parse_inlines(content),
                    sublists: Vec::new(),
                });
            }
            Some(Marker {
                nested: true,
                ordered,
                content,
            }) if self
                .list
                .as_ref()
                .is_some_and(|list| !list.items.is_empty()) =>
            {
                let content = parse_inlines(content);
                let last = self.list.as_mut().and_then(|list| list.items.last_mut());
                if let Some(item) = last {
                    match item.sublists.last_mut() {
                        Some(sublist) if sublist.ordered == ordered => sublist.items.push(content),
                        _ => item.sublists.push(SubList {
                            ordered,
                            items: vec![content],
                        }),
                    }
                }
            }
            _ => {
                self.flush_list();
                self.paragraph.push(line.to_owned());
            }
        }
    }

    fn flush_paragraph(&mut self) {
        if !self.paragraph.is_empty() {
            let text = self.paragraph.join("\n");
            self.paragraph.clear();
            self.done.push(Block::Paragraph(parse_inlines(&text)));
        }
    }

    fn flush_list(&mut self) {
        if let Some(list) = self.list.take() {
            self.done.push(Block::List(List {
                ordered: list.ordered,
                items: list.items,
            }));
        }
    }

    fn finish(mut self) -> Document {
        self.flush_paragraph();
        self.flush_list();
        Document { blocks: self.done }
    }
}

/// The marker a line starts with, if any: `- ` or digits and `. `, followed by text, indented
/// by a tab or two spaces or more for a nested item.
fn marker(line: &str) -> Option<Marker<'_>> {
    let body = line.trim_start_matches([' ', '\t']);
    let indent = line.len() - body.len();
    let nested = match indent {
        0 => false,
        1 if !line.starts_with('\t') => return None,
        _ => true,
    };
    let (ordered, content) = if let Some(rest) = body.strip_prefix("- ") {
        (false, rest)
    } else {
        let digits = body.chars().take_while(char::is_ascii_digit).count();
        let rest = body.get(digits..)?.strip_prefix(". ")?;
        if digits == 0 || digits > MAX_NUMBER_DIGITS {
            return None;
        }
        (true, rest)
    };
    let content = content.trim();
    (!content.is_empty()).then_some(Marker {
        nested,
        ordered,
        content,
    })
}

fn parse_inlines(text: &str) -> Vec<Inline> {
    let chars: Vec<char> = text.chars().collect();
    inlines(&chars, true)
}

fn string(chars: &[char]) -> String {
    chars.iter().collect()
}

/// Recursion is bounded: a mark's closer is the first valid one, so a mark never holds another
/// of its kind, and a cloze's answer holds no cloze.
fn inlines(chars: &[char], cloze_allowed: bool) -> Vec<Inline> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut at = 0;
    while let Some(&ch) = chars.get(at) {
        match ch {
            '\n' => {
                flush(&mut out, &mut text);
                out.push(Inline::LineBreak);
                at += 1;
            }
            '`' => match code_end(chars, at) {
                Some(end) => {
                    flush(&mut out, &mut text);
                    out.push(Inline::Code(string(slice(chars, at + 1, end))));
                    at = end + 1;
                }
                None => {
                    text.push(ch);
                    at += 1;
                }
            },
            '{' => match cloze_span(chars, at).filter(|_| cloze_allowed) {
                Some(span) => {
                    flush(&mut out, &mut text);
                    out.push(Inline::Cloze(Cloze {
                        number: span.number,
                        answer: inlines(slice(chars, span.answer.0, span.answer.1), false),
                        hint: span.hint.map(|(from, to)| string(slice(chars, from, to))),
                    }));
                    at = span.end;
                }
                None => {
                    text.push(ch);
                    at += 1;
                }
            },
            '*' | '_' => {
                let run = run_length(chars, at);
                let can_mark = (run == 1 || (ch == '*' && run == 2)) && opens(chars, at, run, ch);
                let marked = if can_mark {
                    closer(chars, at + run, ch, run, cloze_allowed)
                } else {
                    None
                };
                match marked {
                    Some(close) => {
                        flush(&mut out, &mut text);
                        let inner = inlines(slice(chars, at + run, close), cloze_allowed);
                        out.push(if run == 2 {
                            Inline::Bold(inner)
                        } else {
                            Inline::Italic(inner)
                        });
                        at = close + run;
                    }
                    None => {
                        text.extend(std::iter::repeat_n(ch, run));
                        at += run;
                    }
                }
            }
            _ => {
                text.push(ch);
                at += 1;
            }
        }
    }
    if !text.is_empty() {
        out.push(Inline::Text(text));
    }
    out
}

fn flush(out: &mut Vec<Inline>, text: &mut String) {
    if !text.is_empty() {
        out.push(Inline::Text(std::mem::take(text)));
    }
}

fn slice(chars: &[char], from: usize, to: usize) -> &[char] {
    chars.get(from..to).unwrap_or_default()
}

fn run_length(chars: &[char], at: usize) -> usize {
    let Some(&ch) = chars.get(at) else { return 0 };
    chars
        .get(at..)
        .unwrap_or_default()
        .iter()
        .take_while(|&&next| next == ch)
        .count()
}

/// The index of the backtick closing the code span opened at `open`, on the same line.
fn code_end(chars: &[char], open: usize) -> Option<usize> {
    let rest = chars.get(open + 1..)?;
    let length = rest.iter().position(|&ch| ch == '`' || ch == '\n')?;
    (rest.get(length) == Some(&'`') && length > 0).then_some(open + 1 + length)
}

fn is_word(ch: Option<&char>) -> bool {
    ch.is_some_and(|ch| ch.is_alphanumeric())
}

fn is_space(ch: Option<&char>) -> bool {
    ch.is_some_and(|ch| ch.is_whitespace())
}

/// Whether the run at `at` can open a mark: text that is not a space follows, and an
/// underscore does not follow a letter or digit.
fn opens(chars: &[char], at: usize, run: usize, ch: char) -> bool {
    let next = chars.get(at + run);
    next.is_some() && !is_space(next) && !(ch == '_' && at > 0 && is_word(chars.get(at - 1)))
}

/// The index of the run closing a mark whose content starts at `from`: a run of exactly
/// `run` of `ch`, after a character that is not a space and, for an underscore, before one
/// that is not a letter or digit. Code spans and clozes are skipped whole.
fn closer(chars: &[char], from: usize, ch: char, run: usize, cloze_allowed: bool) -> Option<usize> {
    let mut at = from;
    while let Some(&here) = chars.get(at) {
        if here == '`' {
            if let Some(end) = code_end(chars, at) {
                at = end + 1;
                continue;
            }
        } else if here == '{' && cloze_allowed {
            if let Some(span) = cloze_span(chars, at) {
                at = span.end;
                continue;
            }
        } else if here == ch {
            let length = run_length(chars, at);
            let closes = length == run
                && at > from
                && !is_space(chars.get(at - 1))
                && !(ch == '_' && is_word(chars.get(at + length)));
            if closes {
                return Some(at);
            }
            at += length;
            continue;
        }
        at += 1;
    }
    None
}

/// A cloze span's parts as character indices; `end` is exclusive.
struct ClozeSpan {
    number: u32,
    answer: (usize, usize),
    hint: Option<(usize, usize)>,
    end: usize,
}

/// The cloze span starting at `open`, if one does: `{{c`, a number from 1 of up to nine
/// digits, `::`, then an answer holding a character that is not a space, up to the first
/// `}}`, and, after the first `::` inside, a hint.
fn cloze_span(chars: &[char], open: usize) -> Option<ClozeSpan> {
    let digits_at = open + 3;
    if slice(chars, open, digits_at) != ['{', '{', 'c'] {
        return None;
    }
    let rest = chars.get(digits_at..)?;
    let digits = rest.iter().take_while(|ch| ch.is_ascii_digit()).count();
    if digits == 0 || digits > MAX_NUMBER_DIGITS {
        return None;
    }
    let number: u32 = string(slice(chars, digits_at, digits_at + digits))
        .parse()
        .ok()?;
    let start = digits_at + digits + 2;
    if number == 0 || slice(chars, digits_at + digits, start) != [':', ':'] {
        return None;
    }
    let body = chars.get(start..)?;
    let length = body.windows(2).position(|pair| pair == ['}', '}'])?;
    let end = start + length;
    let split = slice(chars, start, end)
        .windows(2)
        .position(|pair| pair == [':', ':'])
        .map(|offset| start + offset);
    let answer_end = split.unwrap_or(end);
    if slice(chars, start, answer_end)
        .iter()
        .all(|ch| ch.is_whitespace())
    {
        return None;
    }
    let hint = split.map(|at| (at + 2, end)).filter(|(from, to)| from < to);
    Some(ClozeSpan {
        number,
        answer: (start, answer_end),
        hint,
        end: end + 2,
    })
}
