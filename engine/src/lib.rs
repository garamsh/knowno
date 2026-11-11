//! FSRS-6 scheduling: a card's memory state and next due time from its review history, and
//! today's list: the cards a study day still holds, from its reviews.
//!
//! Card text markup, a Markdown subset and Anki's cloze syntax, is parsed by [`parse_markup`].
//!
//! Every function is pure. The engine reads no clock and stores nothing: the caller
//! passes the time of each review and keeps either the history or the state's parts.
//! Invalid input is returned as an [`Error`], never a panic.

#![deny(missing_docs)]

use std::fmt;

mod fsrs;
mod markup;
mod today;

pub use markup::{
    Block, Cloze, Document, Inline, List, ListItem, SubList, escape_literal, parse_markup,
};
pub use today::{StudyDay, Today, today};

const SECONDS_PER_DAY: i64 = 86_400;

/// Why the engine refused its input.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Error {
    /// A review is dated before the card's last review, so the elapsed time would be negative.
    ReviewBeforeLastReview {
        /// The card's last review.
        last_review: Timestamp,
        /// The refused review time.
        review: Timestamp,
    },
    /// A number that is not one of the four FSRS ratings (1 to 4).
    UnknownRating(u8),
    /// A NaN or infinite value given for a quantity.
    NonFinite(Quantity),
    /// A finite value outside the range the quantity allows.
    OutOfRange {
        /// The quantity given.
        quantity: Quantity,
        /// The refused value.
        value: f64,
    },
}

/// A floating-point quantity the engine takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quantity {
    /// Stability: at least 0.001 days.
    Stability,
    /// Difficulty: from 1 to 10.
    Difficulty,
    /// Fuzz factor: from 0, inclusive, to 1, exclusive.
    FuzzFactor,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::ReviewBeforeLastReview {
                last_review,
                review,
            } => write!(
                f,
                "review at {} is before the last review at {}",
                review.0, last_review.0
            ),
            Error::UnknownRating(value) => write!(f, "{value} is not an FSRS rating (1 to 4)"),
            Error::NonFinite(quantity) => write!(f, "{quantity:?} is not finite"),
            Error::OutOfRange { quantity, value } => {
                write!(f, "{quantity:?} {value} is out of range")
            }
        }
    }
}

impl std::error::Error for Error {}

/// An FSRS rating of one review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rating {
    /// Forgot the card.
    Again = 1,
    /// Recalled it with difficulty.
    Hard = 2,
    /// Recalled it.
    Good = 3,
    /// Recalled it easily.
    Easy = 4,
}

impl TryFrom<u8> for Rating {
    type Error = Error;

    /// Parses the FSRS number of a rating: 1 `Again`, 2 `Hard`, 3 `Good`, 4 `Easy`.
    fn try_from(value: u8) -> Result<Self, Error> {
        match value {
            1 => Ok(Rating::Again),
            2 => Ok(Rating::Hard),
            3 => Ok(Rating::Good),
            4 => Ok(Rating::Easy),
            other => Err(Error::UnknownRating(other)),
        }
    }
}

/// The app's two answer buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    /// "Know": rated `Good`.
    Know,
    /// "Don't know": rated `Again`.
    DontKnow,
}

impl From<Answer> for Rating {
    fn from(answer: Answer) -> Self {
        match answer {
            Answer::Know => Rating::Good,
            Answer::DontKnow => Rating::Again,
        }
    }
}

/// A point in time, in whole seconds since the Unix epoch (UTC).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Timestamp(pub i64);

impl Timestamp {
    /// Whole days from `earlier` to `self`; refused when `self` is before `earlier`.
    fn days_since(self, earlier: Timestamp) -> Result<i64, Error> {
        if self < earlier {
            return Err(Error::ReviewBeforeLastReview {
                last_review: earlier,
                review: self,
            });
        }
        Ok(self.0.saturating_sub(earlier.0) / SECONDS_PER_DAY)
    }

    fn plus_days(self, days: u32) -> Timestamp {
        Timestamp(self.0.saturating_add(i64::from(days) * SECONDS_PER_DAY))
    }
}

/// One review in a card's history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Review {
    /// The rating given.
    pub rating: Rating,
    /// When it was given.
    pub at: Timestamp,
}

/// A card's memory state after at least one review.
///
/// The engine produces it from [`review`] or [`replay`], and [`MemoryState::from_parts`]
/// rebuilds it from the parts a caller persisted. A state rebuilt from the parts of
/// `replay(history)` equals `replay(history)`, so a caller may store either.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryState {
    stability: f64,
    difficulty: f64,
    last_review: Timestamp,
}

impl MemoryState {
    /// Rebuilds a state from its persisted parts, refusing values no review produces.
    pub fn from_parts(
        stability: f64,
        difficulty: f64,
        last_review: Timestamp,
    ) -> Result<MemoryState, Error> {
        check(
            Quantity::Stability,
            stability,
            fsrs::STABILITY_MIN,
            f64::MAX,
        )?;
        check(
            Quantity::Difficulty,
            difficulty,
            fsrs::DIFFICULTY_MIN,
            fsrs::DIFFICULTY_MAX,
        )?;
        Ok(MemoryState {
            stability,
            difficulty,
            last_review,
        })
    }

    /// Days until retrievability falls to 0.9.
    pub fn stability(&self) -> f64 {
        self.stability
    }

    /// Difficulty, from 1 to 10.
    pub fn difficulty(&self) -> f64 {
        self.difficulty
    }

    /// Time of the review that produced this state.
    pub fn last_review(&self) -> Timestamp {
        self.last_review
    }

    /// Probability of recall at `now`, counting only whole elapsed days.
    pub fn retrievability(&self, now: Timestamp) -> Result<f64, Error> {
        let elapsed = now.days_since(self.last_review)?;
        Ok(fsrs::retrievability(elapsed as f64, self.stability))
    }
}

/// The draw that picks a fuzzed interval within its range, as py-fsrs's `random()` does.
///
/// The engine draws nothing itself: the caller supplies the factor and keeps it, so a
/// review computed again with the same factor falls due at the same time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FuzzFactor(f64);

impl FuzzFactor {
    /// Accepts a value from 0, inclusive, to 1, exclusive.
    pub fn new(value: f64) -> Result<FuzzFactor, Error> {
        if !value.is_finite() {
            Err(Error::NonFinite(Quantity::FuzzFactor))
        } else if !(0.0..1.0).contains(&value) {
            Err(Error::OutOfRange {
                quantity: Quantity::FuzzFactor,
                value,
            })
        } else {
            Ok(FuzzFactor(value))
        }
    }

    /// The factor, from 0, inclusive, to 1, exclusive.
    pub fn value(&self) -> f64 {
        self.0
    }
}

fn check(quantity: Quantity, value: f64, min: f64, max: f64) -> Result<(), Error> {
    if !value.is_finite() {
        Err(Error::NonFinite(quantity))
    } else if !(min..=max).contains(&value) {
        Err(Error::OutOfRange { quantity, value })
    } else {
        Ok(())
    }
}

/// Reviews a card, or a new card when `state` is `None`, and returns its new state and due time.
///
/// With a `fuzz` factor, an interval of at least 2.5 days is spread as py-fsrs fuzzes it;
/// without one, the interval is not fuzzed. The state is the same either way.
pub fn review(
    state: Option<&MemoryState>,
    rating: Rating,
    now: Timestamp,
    fuzz: Option<FuzzFactor>,
) -> Result<(MemoryState, Timestamp), Error> {
    let (stability, difficulty) = match state {
        None => (
            fsrs::initial_stability(rating),
            fsrs::initial_difficulty(rating),
        ),
        Some(state) => {
            let stability = if now.days_since(state.last_review)? < 1 {
                fsrs::short_term_stability(state.stability, rating)
            } else {
                fsrs::next_stability(
                    state.difficulty,
                    state.stability,
                    state.retrievability(now)?,
                    rating,
                )
            };
            (stability, fsrs::next_difficulty(state.difficulty, rating))
        }
    };
    let next = MemoryState {
        stability,
        difficulty,
        last_review: now,
    };
    let days = fsrs::interval_days(stability);
    let days = match fuzz {
        Some(fuzz) => fsrs::fuzzed_interval_days(days, fuzz.0),
        None => days,
    };
    Ok((next, now.plus_days(days)))
}

/// Replays a history, in the order the reviews happened, into the card's state; `None` when empty.
///
/// Fuzz moves only due times, never a state, so the history carries no fuzz factor.
pub fn replay(history: &[Review]) -> Result<Option<MemoryState>, Error> {
    history.iter().try_fold(None, |state, step| {
        review(state.as_ref(), step.rating, step.at, None).map(|(next, _)| Some(next))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn know_answers_good_and_dont_know_answers_again() {
        assert_eq!(Rating::from(Answer::Know), Rating::Good);
        assert_eq!(Rating::from(Answer::DontKnow), Rating::Again);
    }
}
