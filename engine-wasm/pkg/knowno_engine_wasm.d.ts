/* tslint:disable */
/* eslint-disable */
/**
 * A block of a parsed text: a paragraph or a list.
 */
export type Block = { type: "paragraph"; content: Inline[] } | { type: "list"; ordered: boolean; items: ListItem[] };

/**
 * A card as today's list reads it: when it is due, absent for a card never reviewed, and its
 * reviews, in any order, those outside the study day included or not.
 */
export interface TodayCard {
    /**
     * When the card is due.
     */
    due: bigint | null;
    /**
     * The card's reviews.
     */
    reviews: ReviewRecord[];
}

/**
 * A card's state after a review, and when it is next due.
 */
export interface Scheduled {
    /**
     * The new memory state.
     */
    state: MemoryStateParts;
    /**
     * When the card is next due.
     */
    due: bigint;
}

/**
 * A floating-point quantity the engine takes.
 */
export type Quantity = "stability" | "difficulty" | "fuzzFactor";

/**
 * A list one level down; its items hold no list.
 */
export interface SubList {
    /**
     * Numbered, counted from 1, rather than bulleted.
     */
    ordered: boolean;
    /**
     * The items' lines, at least one.
     */
    items: Inline[][];
}

/**
 * An item of a list, with the lists nested under it.
 */
export interface ListItem {
    /**
     * The item's line.
     */
    content: Inline[];
    /**
     * The indented lists under the item.
     */
    sublists: SubList[];
}

/**
 * One review in a card's history.
 */
export interface ReviewRecord {
    /**
     * The answer given.
     */
    answer: Answer;
    /**
     * When it was given.
     */
    at: bigint;
}

/**
 * Text inside a block.
 */
export type Inline = { type: "text"; text: string } | { type: "lineBreak" } | { type: "bold"; content: Inline[] } | { type: "italic"; content: Inline[] } | { type: "code"; text: string } | { type: "cloze"; number: number; answer: Inline[]; hint: string | null } | { type: "blank"; hint: string | null };

/**
 * The app's two answer buttons.
 */
export type Answer = "know" | "dontKnow";

/**
 * The parts of a card's memory state that a caller persists.
 */
export interface MemoryStateParts {
    /**
     * Days until retrievability falls to 0.9.
     */
    stability: number;
    /**
     * Difficulty, from 1 to 10.
     */
    difficulty: number;
    /**
     * Time of the review that produced this state.
     */
    lastReview: bigint;
}

/**
 * What an operation returns: its value under `ok`, or the engine's refusal under `error`.
 */
export type Outcome<T> = { ok: T } | { error: EngineError };

/**
 * Where a card stands in today's list.
 */
export type Today = "absent" | "left" | "done";

/**
 * Why the engine refused its input; one variant per engine `Error` variant, told apart by `kind`.
 */
export type EngineError = { kind: "reviewBeforeLastReview"; lastReview: bigint; review: bigint } | { kind: "unknownRating"; value: number } | { kind: "nonFinite"; quantity: Quantity } | { kind: "outOfRange"; quantity: Quantity; value: number };


/**
 * The cloze numbers a card text holds, ascending, each once.
 */
export function clozeNumbers(text: string): Uint32Array;

/**
 * A text written as markup that reads back as exactly that text, `\r\n` and `\r` as `\n`:
 * the form every literal run is saved in.
 */
export function escapeLiteral(text: string): string;

/**
 * A card text with every cloze shown as its answer.
 */
export function fillCloze(text: string): Block[];

/**
 * A card text with each span of cloze `number` a `blank` carrying its hint, and every other
 * cloze shown as its answer.
 */
export function hideCloze(text: string, number: number): Block[];

/**
 * Parses a card text into its blocks. Every text parses: markup that is not closed, or not in
 * the subset, is literal text.
 */
export function parseMarkup(text: string): Block[];

/**
 * A card text without marks, clozes filled, for the card key.
 */
export function plainText(text: string): string;

/**
 * Replays a history, in the order the reviews happened, into the card's state; `null` when empty.
 */
export function replay(history: ReviewRecord[]): Outcome<MemoryStateParts | null>;

/**
 * Probability of recall at `at` of a card whose state the caller persisted as `state`.
 */
export function retrievability(state: MemoryStateParts, at: bigint): Outcome<number>;

/**
 * Reviews a card whose state the caller persisted as `state`, its interval fuzzed by
 * the fuzz factor, a value in `[0, 1)`, or not fuzzed when it is absent.
 */
export function reviewCard(state: MemoryStateParts, answer: Answer, at: bigint, fuzzFactor?: number | null): Outcome<Scheduled>;

/**
 * Reviews a new card for the first time, its interval fuzzed by the fuzz factor, a value
 * in `[0, 1)`, or not fuzzed when it is absent.
 */
export function reviewNewCard(answer: Answer, at: bigint, fuzzFactor?: number | null): Outcome<Scheduled>;

/**
 * Where each card stands in the list of the study day from `dayStart`, inclusive, to `dayEnd`,
 * exclusive, in the order given.
 */
export function todaysList(cards: TodayCard[], dayStart: bigint, dayEnd: bigint): Today[];

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly clozeNumbers: (a: number, b: number, c: number) => void;
    readonly escapeLiteral: (a: number, b: number, c: number) => void;
    readonly fillCloze: (a: number, b: number, c: number) => void;
    readonly hideCloze: (a: number, b: number, c: number, d: number) => void;
    readonly parseMarkup: (a: number, b: number, c: number) => void;
    readonly plainText: (a: number, b: number, c: number) => void;
    readonly replay: (a: number, b: number, c: number) => void;
    readonly retrievability: (a: number, b: number, c: bigint) => void;
    readonly reviewCard: (a: number, b: number, c: number, d: bigint, e: number, f: number) => void;
    readonly reviewNewCard: (a: number, b: number, c: bigint, d: number, e: number) => void;
    readonly todaysList: (a: number, b: number, c: number, d: bigint, e: bigint) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
