import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { render } from "@/testing/render";
import { cardRow, deckRow, side, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { supabaseUrl, testAccessToken } from "@/testing/mocks/handlers";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";
import { AuthoringButton } from "../components/authoring-button";
import { preparePhoto } from "../extract-photo";
import { describeFailure } from "../photo-failure";
import { readPhoto } from "../read-photo";
import { parseDeckId } from "../library";
import { field } from "@/supabase/row";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  db.seed("decks", deckRow("deck", "단어장"));
  server.use(
    ...db.handlers,
    http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
      HttpResponse.json([{ photo_limit: 10, used: 2, period: "month" }]),
    ),
  );
  setRequestCookies(await signedInCookies());
});
const deckId = parseDeckId(uuidOf("deck"));
if (!deckId) throw new Error("fixture deck id");
const deck = { id: deckId, name: "단어장", public: false };

describe("authoring from the page", () => {
  it("closes a pristine draft directly and confirms dirty dismissal without losing a kept draft", async () => {
    await render(() => <AuthoringButton deck={deck} />, {});
    await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "draft");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("heading", { name: "작성 중인 카드를 버릴까요?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveValue("draft");
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "버리기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.rows.cards).toHaveLength(0);
  });

  it("keeps a manual draft after a failed save, then saves meanings and labels once", async () => {
    await render(() => <AuthoringButton deck={deck} />, {});
    await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    await userEvent.click(screen.getByRole("button", { name: "1번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "단어" }));
    await userEvent.type(screen.getByRole("textbox", { name: "단어" }), "apple");
    await userEvent.type(screen.getByRole("textbox", { name: "뜻" }), "사과");
    await userEvent.type(screen.getByRole("textbox", { name: "라벨" }), "명");
    const release = db.fail("cards", 400);
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("카드를 저장하지 못했어요");
    expect(screen.getByRole("textbox", { name: "단어" })).toHaveValue("apple");
    release();
    await userEvent.dblClick(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(db.rows.cards[0]).toMatchObject({ template: "free", template_version: 2, back: [] });
    expect(db.rows.cards[0]?.front).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "senses",
          v: 2,
          payload: {
            term: "apple",
            ask: "term",
            senses: [
              {
                labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
                meaning: "사과",
                examples: [],
              },
            ],
          },
        }),
      ]),
    );
  });
  it("opens nothing when the picker is cancelled, and keeps the choices usable", async () => {
    await render(() => <AuthoringButton deck={deck} />, {});
    await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
    const picker = screen.getByLabelText("앨범에서 고르기", { selector: "input" });
    fireEvent.change(picker, { target: { files: [] } });
    expect(screen.getByRole("heading", { name: "카드 추가" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "카드를 찾고 있어요" })).not.toBeInTheDocument();
    expect(picker).toBeEnabled();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(db.rows.cards).toHaveLength(0);
  });
});

/** A JPEG's first bytes, which `readPhoto` reads as its type. */
const jpegBytes = [255, 216, 255, 0];
function upload() {
  const file = new File([new Uint8Array(jpegBytes)], "photo.jpg", { type: "image/jpeg" });
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new Uint8Array(jpegBytes).buffer),
  });
  return file;
}
const card = { kind: "note", type: "concept", front: "수도", answer: "서울", topic: "도시" };

/**
 * Whether [value] holds the members `preparePhoto` uses of a 2D context. jsdom has no 2D context,
 * so the stub holds only those members; this check is what lets it stand for one.
 */
function isDrawingContext(value: unknown): value is CanvasRenderingContext2D {
  return (
    typeof value === "object" &&
    value !== null &&
    "fillStyle" in value &&
    "fillRect" in value &&
    typeof value.fillRect === "function" &&
    "drawImage" in value &&
    typeof value.drawImage === "function"
  );
}

/** jsdom decodes and draws nothing: the browser's decoder and canvas, as far as preparation uses them. */
function stubBrowserImages({
  width = 1200,
  height = 900,
  decodes = true,
  sizes = [] as number[],
} = {}) {
  const drawn: { width: number; height: number }[] = [];
  const qualities: number[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((_: Blob, options?: ImageBitmapOptions) =>
      decodes
        ? Promise.resolve({ width, height, close: vi.fn(), options })
        : Promise.reject(new DOMException("unsupported", "InvalidStateError")),
    ),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const context: unknown = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: () => {
        drawn.push({ width: this.width, height: this.height });
      },
    };
    if (!isDrawingContext(context)) throw new Error("the stub lacks what preparePhoto draws with");
    return context;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback: BlobCallback, type?: string, quality?: number) => {
      qualities.push(quality ?? 1);
      const size = sizes[qualities.length - 1] ?? 1000;
      const bytes = new Uint8Array(size);
      bytes.set(jpegBytes);
      const blob = new Blob([bytes], { type });
      Object.defineProperty(blob, "arrayBuffer", {
        value: () => Promise.resolve(bytes.buffer),
      });
      callback(blob);
    },
  );
  return { drawn, qualities };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("photo preparation", () => {
  it("scales a large photo to 2048 px on its long side and asks the decoder for its EXIF orientation", async () => {
    const { drawn } = stubBrowserImages({ width: 4000, height: 3000 });
    const prepared = await preparePhoto(new File([new Uint8Array(8 * 1024 * 1024)], "big.jpg"));
    expect(prepared).toBeInstanceOf(File);
    expect(prepared).toHaveProperty("type", "image/jpeg");
    expect(drawn).toEqual([{ width: 2048, height: 1536 }]);
    expect(vi.mocked(createImageBitmap).mock.calls[0]?.[1]).toEqual({
      imageOrientation: "from-image",
    });
  });
  it("re-encodes a small PNG as JPEG at its own size, rather than sending it as it is", async () => {
    const { drawn } = stubBrowserImages({ width: 800, height: 600 });
    const png = new File([new Uint8Array([137, 80, 78, 71])], "small.png", { type: "image/png" });
    const prepared = await preparePhoto(png);
    expect(prepared).not.toBe(png);
    expect(prepared).toHaveProperty("type", "image/jpeg");
    expect(drawn).toEqual([{ width: 800, height: 600 }]);
  });
  it("lowers the quality until the photo is under the upload bound, and refuses one that never is", async () => {
    const over = 3 * 1024 * 1024 + 1;
    const fits = stubBrowserImages({ sizes: [over, over, 1000] });
    expect(await preparePhoto(new Blob())).toBeInstanceOf(File);
    expect(fits.qualities).toEqual([0.85, 0.7, 0.55]);
    vi.restoreAllMocks();
    stubBrowserImages({ sizes: [over, over, over, over] });
    expect(await preparePhoto(new Blob())).toEqual({ kind: "refused" });
  });
  it("names the formats to choose for a photo the browser cannot decode", async () => {
    stubBrowserImages({ decodes: false });
    const failure = await preparePhoto(new File([new Uint8Array(4)], "photo.heic"));
    expect(failure).toEqual({ kind: "unreadable" });
    if (!("kind" in failure)) throw new Error("decoded");
    expect(describeFailure(failure)).toBe(
      "이 사진을 읽을 수 없어요. JPEG, PNG, WebP 사진을 골라 주세요.",
    );
  });
});

describe("photo request", () => {
  it("refuses empty, oversized and signed-out uploads before calling extraction beside a valid authenticated upload", async () => {
    let calls = 0;
    server.use(
      http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
        calls += 1;
        expect(request.headers.get("authorization")).toBe(`Bearer ${testAccessToken}`);
        const body: unknown = await request.json();
        expect(body).toEqual({ image: Buffer.from(jpegBytes).toString("base64") });
        return HttpResponse.json({ cards: [card] });
      }),
    );
    expect(await readPhoto(new FormData())).toEqual({ failure: { kind: "refused" } });
    const large = new FormData();
    large.set("photo", new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.jpg"));
    expect(await readPhoto(large)).toEqual({ failure: { kind: "refused" } });
    expect(calls).toBe(0);
    const valid = new FormData();
    valid.set("photo", upload());
    expect(await readPhoto(valid)).toMatchObject({
      cards: [{ topic: "도시", selected: null }],
      cursor: null,
    });
    expect(calls).toBe(1);
    setRequestCookies([]);
    expect(await readPhoto(valid)).toEqual({ failure: { kind: "signIn" } });
    expect(calls).toBe(1);
  });
  it.each([
    [502, {}, { kind: "model" }],
    [503, {}, { kind: "service" }],
    [403, { error: "suspended" }, { kind: "suspended" }],
    [403, { error: "forbidden" }, { kind: "service" }],
    [413, {}, { kind: "refused" }],
    [415, {}, { kind: "refused" }],
    [422, { error: "no_cards" }, { kind: "noCards" }],
    [429, { photo_limit: 10, period: "month" }, { kind: "limit", limit: 10, period: "month" }],
    [429, {}, { kind: "service" }],
    [401, {}, { kind: "signIn" }],
    [200, { cards: [] }, { kind: "service" }],
  ])(
    "reads a %i answer as the phone's failure kind, sending the photo once",
    async (status, body, failure) => {
      let calls = 0;
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, () => {
          calls += 1;
          return HttpResponse.json(body, { status });
        }),
      );
      const form = new FormData();
      form.set("photo", upload());
      expect(await readPhoto(form)).toEqual({ failure });
      expect(calls).toBe(1);
    },
  );
  it("reads a cursor only beside partial true, and none from an answer read whole", async () => {
    for (const [body, cursor] of [
      [{ cards: [card], partial: true, cursor: "next" }, "next"],
      [{ cards: [card], partial: "yes", cursor: "next" }, null],
      [{ cards: [card], partial: true }, null],
      [{ cards: [card] }, null],
    ] as const) {
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, () => HttpResponse.json(body)),
      );
      const form = new FormData();
      form.set("photo", upload());
      expect(await readPhoto(form)).toMatchObject({ cursor });
    }
  });
  it("reads an answer of up to the photo's 500 cards, which a request reading on past its first reply holds, and refuses one past them", async () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, at) => ({ ...card, front: `수도 ${String(at)}` }));
    for (const [count, read] of [
      [500, true],
      [501, false],
    ] as const) {
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, () =>
          HttpResponse.json({ cards: many(count), partial: false }),
        ),
      );
      const form = new FormData();
      form.set("photo", upload());
      const result = await readPhoto(form);
      expect("cards" in result ? result.cards.length : result.failure.kind).toBe(
        read ? count : "service",
      );
    }
  });
  it("sends a cursor back with the photo, takes a resumed answer of no card, and reads a 410 as the retryable service failure", async () => {
    const bodies: unknown[] = [];
    const answers = [
      HttpResponse.json({ cards: [], partial: false }),
      HttpResponse.json({ error: "cursor_expired" }, { status: 410 }),
    ];
    server.use(
      http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
        bodies.push(await request.json());
        return answers[bodies.length - 1];
      }),
    );
    const form = new FormData();
    form.set("photo", upload());
    form.set("cursor", "next");
    expect(await readPhoto(form)).toEqual({ cards: [], cursor: null });
    expect(await readPhoto(form)).toEqual({ failure: { kind: "service" } });
    expect(bodies).toEqual([
      { image: Buffer.from(jpegBytes).toString("base64"), cursor: "next" },
      { image: Buffer.from(jpegBytes).toString("base64"), cursor: "next" },
    ]);
    // A cursor past the function's bound is refused before any call.
    form.set("cursor", "x".repeat(24 * 1024 + 1));
    expect(await readPhoto(form)).toEqual({ failure: { kind: "refused" } });
    expect(bodies).toHaveLength(2);
  });
  it("sends a photo once more after no response, and logs one line with the status and latency, never the image or token", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let calls = 0;
    server.use(
      http.post(`${supabaseUrl}/functions/v1/extract-cards`, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.error() : HttpResponse.json({ cards: [card] });
      }),
    );
    const form = new FormData();
    form.set("photo", upload());
    expect(await readPhoto(form)).toHaveProperty("cards");
    expect(calls).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "read_photo",
      status: 200,
      attempts: 2,
      outcome: "cards",
      cards: 1,
      ms: expect.any(Number) as unknown,
    });
    expect(line).not.toContain(testAccessToken);
    expect(line).not.toContain(Buffer.from(jpegBytes).toString("base64"));
  });
  describe("on a clock the test moves", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      // Node's own timeout signal runs on a timer the fake clock does not move; this one does.
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => {
          controller.abort(new DOMException("signal timed out", "TimeoutError"));
        }, ms);
        return controller.signal;
      });
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    /**
     * The function's cards, answered once [ms] of the clock have passed since the request arrived;
     * `arrived` settles as it does, so the clock moves only once the request waits on it.
     */
    function answerAfter(ms: number) {
      const sent = { count: 0 };
      const { promise: arrived, resolve } = Promise.withResolvers<void>();
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, async () => {
          sent.count += 1;
          const answered = new Promise((done) => setTimeout(done, ms));
          resolve();
          await answered;
          return HttpResponse.json({ cards: [card] });
        }),
      );
      return { sent, arrived };
    }
    it("waits out the function's worst case, a retry that times out by about 135 s", async () => {
      const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { sent, arrived } = answerAfter(139_000);
      const form = new FormData();
      form.set("photo", upload());
      const result = readPhoto(form);
      await arrived;
      await vi.advanceTimersByTimeAsync(139_000);
      expect(await result).toHaveProperty("cards");
      expect(sent.count).toBe(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ status: 200 });
    });
    it("stops waiting before the Edge Function's 150 s wall clock, as a timeout sent once", async () => {
      const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const { sent, arrived } = answerAfter(10 * 60_000);
      const form = new FormData();
      form.set("photo", upload());
      const result = readPhoto(form);
      await arrived;
      await vi.advanceTimersByTimeAsync(150_000);
      expect(await result).toEqual({ failure: { kind: "service" } });
      expect(sent.count).toBe(1);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        status: "timeout",
        attempts: 1,
      });
    });
  });
  it("gives up after a second request with no response, as a service failure to retry", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let calls = 0;
    server.use(
      http.post(`${supabaseUrl}/functions/v1/extract-cards`, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const form = new FormData();
    form.set("photo", upload());
    expect(await readPhoto(form)).toEqual({ failure: { kind: "service" } });
    expect(calls).toBe(2);
  });
});

describe("photo import", () => {
  beforeEach(() => {
    stubBrowserImages();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    URL.createObjectURL = () => "blob:photo";
    URL.revokeObjectURL = () => undefined;
  });
  /** Picks [count] photos from the album on the deck's 카드 추가 sheet. */
  async function choose(count: number) {
    const files = Array.from({ length: count }, (_, at) => new File([], `${String(at)}.jpg`));
    await render(() => <AuthoringButton deck={deck} />, {});
    await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
    const picker = screen.getByLabelText("앨범에서 고르기", { selector: "input" });
    fireEvent.change(picker, { target: { files } });
  }
  /** The function's answers in turn, counting the photos sent. */
  function answer(...answers: { status: number; body: Record<string, unknown> }[]) {
    const sent = { count: 0 };
    server.use(
      http.post(`${supabaseUrl}/functions/v1/extract-cards`, () => {
        const next = answers[Math.min(sent.count, answers.length - 1)];
        sent.count += 1;
        return HttpResponse.json(next?.body, { status: next?.status });
      }),
    );
    return sent;
  }
  const failed502 = { status: 502, body: { error: "model_error" } };
  const read = { status: 200, body: { cards: [card] } };

  it("shows one photo's 502 as the phone's model failure, and its retry sends that photo again into the list", async () => {
    const sent = answer(failed502, read);
    await choose(1);
    expect(
      await screen.findByText("카드를 읽지 못했어요. 잠시 후 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src*="knowno-sad"]')).not.toBeNull();
    expect(sent.count).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "카드 1장을 만들었어요" }),
    ).toBeInTheDocument();
    expect(sent.count).toBe(2);
    expect(screen.getByRole("heading", { name: "도시 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "카드 1장 추가" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
  });
  it("offers no retry for a failure sending again cannot fix, against the retake it does offer", async () => {
    answer({ status: 422, body: { error: "no_cards" } });
    await choose(1);
    expect(
      await screen.findByText("카드를 찾지 못했어요. 더 밝고 반듯하게 찍어 보세요."),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src*="knowno-sad"]')).not.toBeNull();
    expect(screen.getByLabelText("다른 사진 고르기", { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });
  it("reads several photos with a row each, retries only the failed one in place, then opens the list", async () => {
    const sent = answer(failed502, read, read);
    await choose(2);
    expect(
      await screen.findByRole("heading", { name: "사진 1장을 읽지 못했어요" }),
    ).toBeInTheDocument();
    expect(sent.count).toBe(2);
    // Never beside a failure's red: the row's icon is the screen's one mark.
    expect(document.querySelector('img[src*="knowno-thinking"]')).toBeNull();
    expect(screen.getByText("카드 1장")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "사진 1 빼기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "사진 2 다시 시도" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "사진 1 다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" }),
    ).toBeInTheDocument();
    expect(sent.count).toBe(3);
    expect(screen.getByRole("heading", { name: "사진 1, 카드 1장" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "사진 2, 카드 1장" })).toBeInTheDocument();
  });
  it("re-sends every retryable failed photo at once, leaving a failure sending cannot fix on its row", async () => {
    const sent = answer(failed502, { status: 422, body: { error: "no_cards" } }, failed502, read);
    await choose(3);
    expect(
      await screen.findByRole("heading", { name: "사진 3장을 읽지 못했어요" }),
    ).toBeInTheDocument();
    expect(sent.count).toBe(3);
    await userEvent.click(screen.getByRole("button", { name: "실패한 사진 다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "사진 1장을 읽지 못했어요" }),
    ).toBeInTheDocument();
    expect(sent.count).toBe(5);
    expect(screen.getAllByText("카드 1장")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "사진 2 빼기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "실패한 사진 다시 시도" })).not.toBeInTheDocument();
  });
  it("reads only the photos the period leaves, and says so", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: 10, used: 9, period: "day" }]),
      ),
    );
    const sent = answer(failed502);
    await choose(3);
    expect(
      await screen.findByText("오늘 1장 더 만들 수 있어요. 처음 1장만 읽어요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("사진 2")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(sent.count).toBe(1);
    });
  });
  it("reads every photo, with no note, when no limit applies", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: null, used: 40, period: "month" }]),
      ),
    );
    const sent = answer(read);
    await choose(3);
    await waitFor(() => {
      expect(sent.count).toBe(3);
    });
    expect(screen.queryByText(/더 만들 수 있어요/)).not.toBeInTheDocument();
    expect(screen.queryByText(/다 썼어요/)).not.toBeInTheDocument();
  });
  it("shows the period's limit before sending any photo when none is left", async () => {
    server.use(
      http.post(`${supabaseUrl}/rest/v1/rpc/extraction_allowance`, () =>
        HttpResponse.json([{ photo_limit: 10, used: 10, period: "month" }]),
      ),
    );
    const sent = answer(read);
    await choose(2);
    expect(
      await screen.findByText(
        "이번 달 사진으로 만들 수 있는 10장을 다 썼어요. 다음 달 1일에 다시 시도해 주세요.",
      ),
    ).toBeInTheDocument();
    expect(sent.count).toBe(0);
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  describe("the review list", () => {
    const noun = { kind: "part_of_speech", category: "noun", text: "명" };
    const apple = {
      kind: "vocabulary",
      type: "concept",
      front: "apple",
      answer: "사과",
      topic: "과일",
      senses: [
        { labels: [noun], meaning: "사과", examples: [] },
        { labels: [], meaning: "사과나무", examples: [] },
      ],
      pronunciation: "ˈæpəl",
      extras: [{ label: "유의어", text: "pome" }],
    };
    const identify = { ...card, type: "identify", front: "수도는?", answer: "서울" };
    const words = { status: 200, body: { cards: [apple] } };
    /** The section menu named for [topic] in its form [form], opened. */
    async function openMenu(topic: string, form: string) {
      await userEvent.click(screen.getByRole("button", { name: `${topic} 카드 모양, ${form}` }));
      return screen.getByRole("menu", { name: `${topic} 카드 모양` });
    }
    /** The type and payload of a stored card's first 칸. */
    function firstBlock(side: unknown) {
      const first: unknown = Array.isArray(side) ? side[0] : undefined;
      return { type: field(first, "type"), payload: field(first, "payload") };
    }
    /** A menu's items of every role, in their order. */
    function items(menu: HTMLElement) {
      return Array.from(menu.querySelectorAll("[role^=menuitem]"));
    }
    afterEach(() => {
      localStorage.clear();
    });

    it("turns a vocabulary section's cards from its menu, and saves both directions as two cards", async () => {
      answer(words);
      await choose(1);
      expect(await screen.findByRole("heading", { name: "단어를 찾았어요" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "과일 1" })).toBeInTheDocument();
      const menu = await openMenu("과일", "앞면에 단어");
      expect(
        items(menu).map((item) => [item.textContent, item.getAttribute("aria-checked")]),
      ).toEqual([
        ["앞면에 단어", "true"],
        ["앞면에 뜻", "false"],
        ["양쪽 방향 모두", "false"],
        ["첫 뜻만", "false"],
        ["라벨 표시", "true"],
        ["발음 표시", "false"],
        ["유의어 등 표시", "false"],
        ["이 묶음 빼기", null],
      ]);
      await userEvent.click(within(menu).getByRole("menuitemradio", { name: "앞면에 뜻" }));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      // The row's edit button is named by its front, which now is the meaning.
      expect(screen.getByRole("button", { name: "[명] 사과\n사과나무 편집" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "카드 1장 추가" })).toBeInTheDocument();
      await userEvent.click(
        within(await openMenu("과일", "앞면에 뜻")).getByRole("menuitemradio", {
          name: "양쪽 방향 모두",
        }),
      );
      expect(screen.getByRole("button", { name: "과일 카드 모양, 양쪽 방향" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "카드 2장 추가" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(2);
      });
      // One card word to meaning, the other meaning to word.
      expect(
        db.rows.cards.map((row) => [row.card_key, firstBlock(row.front).type, row.back]).sort(),
      ).toEqual([
        ["[명] 사과 사과나무", "senses", []],
        ["apple", "senses", []],
      ]);
      expect(
        db.rows.cards.map((row) => field(firstBlock(row.front).payload, "ask")).sort(),
      ).toEqual(["meaning", "term"]);
    });
    it("shows the first sense alone without its part of speech, with the pronunciation and extras, as the menu sets", async () => {
      answer(words);
      await choose(1);
      await screen.findByRole("heading", { name: "단어를 찾았어요" });
      for (const setting of ["첫 뜻만", "라벨 표시", "발음 표시", "유의어 등 표시"])
        await userEvent.click(
          within(await openMenu("과일", "앞면에 단어")).getByRole("menuitemcheckbox", {
            name: setting,
          }),
        );
      const row = screen.getByRole("button", { name: /편집$/u });
      expect(row).toHaveAccessibleName("apple 편집");
      expect(row).toHaveTextContent("ˈæpəl");
      expect(row).not.toHaveTextContent("사과나무");
      expect(row).not.toHaveTextContent("[명]");
      expect(row).toHaveTextContent("유의어 pome");
      await userEvent.click(screen.getByRole("button", { name: "카드 1장 추가" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(1);
      });
      expect(db.rows.cards[0]).toMatchObject({ template_version: 2, back: [] });
      expect(db.rows.cards[0]?.front).toEqual([
        expect.objectContaining({
          type: "senses",
          payload: {
            term: "apple",
            ask: "term",
            senses: [{ labels: [], meaning: "사과", examples: [] }],
          },
        }),
        expect.objectContaining({
          type: "text",
          payload: { front: "", back: "ˈæpəl\n유의어 pome" },
        }),
      ]);
    });
    it("swaps a note section's sides, and leaves a section out and puts it back from its menu", async () => {
      answer({ status: 200, body: { cards: [card, { ...card, front: "인구", answer: "많음" }] } });
      await choose(1);
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" });
      const menu = await openMenu("도시", "앞면에 질문");
      expect(items(menu).map((item) => item.textContent)).toEqual([
        "앞면과 뒷면 바꾸기",
        "이 묶음 빼기",
      ]);
      await userEvent.click(
        within(menu).getByRole("menuitemcheckbox", { name: "앞면과 뒷면 바꾸기" }),
      );
      expect(screen.getByRole("button", { name: "서울 편집" })).toBeInTheDocument();
      await userEvent.click(
        within(await openMenu("도시", "앞면에 답")).getByRole("menuitem", { name: "이 묶음 빼기" }),
      );
      expect(screen.getAllByRole("checkbox", { checked: false })).toHaveLength(2);
      expect(screen.getByRole("button", { name: "카드 0장 추가" })).toBeDisabled();
      await userEvent.click(
        within(await openMenu("도시", "앞면에 답")).getByRole("menuitem", { name: "이 묶음 넣기" }),
      );
      expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "카드 2장 추가" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(2);
      });
      expect(
        db.rows.cards.map((row) => field(firstBlock(row.front).payload, "front")).sort(),
      ).toEqual(["많음", "서울"]);
    });
    it("closes the menu on Escape alone, returning focus to its button, and keeps the sheet open", async () => {
      answer(words);
      await choose(1);
      await screen.findByRole("heading", { name: "단어를 찾았어요" });
      const menu = await openMenu("과일", "앞면에 단어");
      expect(within(menu).getByRole("menuitemradio", { name: "앞면에 단어" })).toHaveFocus();
      await userEvent.keyboard("{ArrowDown}");
      expect(within(menu).getByRole("menuitemradio", { name: "앞면에 뜻" })).toHaveFocus();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "과일 카드 모양, 앞면에 단어" })).toHaveFocus();
      expect(screen.getByRole("heading", { name: "단어를 찾았어요" })).toBeInTheDocument();
    });
    it("marks a card the deck holds 이미 노트에 있어요 and leaves it out, beside a new one included", async () => {
      db.seed("cards", cardRow("held", "deck", "수도"));
      answer({ status: 200, body: { cards: [card, { ...card, front: "인구", answer: "많음" }] } });
      await choose(1);
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" });
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "수도 선택" })).not.toBeChecked();
      });
      expect(screen.getByRole("button", { name: "수도 편집" })).toHaveTextContent(
        "이미 노트에 있어요",
      );
      expect(screen.getByRole("checkbox", { name: "인구 선택" })).toBeChecked();
      expect(screen.getByRole("button", { name: "인구 편집" })).not.toHaveTextContent(
        "이미 노트에 있어요",
      );
      await userEvent.click(screen.getByRole("checkbox", { name: "수도 선택" }));
      expect(screen.getByRole("checkbox", { name: "수도 선택" })).toBeChecked();
    });
    it("merges a checked card the deck holds into it on saving, as the phone does, beside a new one inserted", async () => {
      db.seed("cards", cardRow("held", "deck", "수도"));
      answer({ status: 200, body: { cards: [card, { ...card, front: "인구", answer: "많음" }] } });
      await choose(1);
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" });
      await waitFor(() => {
        expect(screen.getByRole("checkbox", { name: "수도 선택" })).not.toBeChecked();
      });
      await userEvent.click(screen.getByRole("checkbox", { name: "수도 선택" }));
      await userEvent.click(screen.getByRole("button", { name: "카드 2장 추가" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(2);
      });
      await waitFor(() => {
        expect(db.rows.cards[0]?.back).toEqual([
          ...side("수도 back"),
          expect.objectContaining({ type: "text", payload: { text: "서울" } }),
        ]);
      });
      expect(db.rows.cards[0]?.id).toBe(uuidOf("held"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "카드 2장 추가" })).not.toBeInTheDocument();
    });
    it("counts two photos' cards of one key as one on the add button, and saves one card", async () => {
      answer({ status: 200, body: { cards: [card] } });
      await choose(2);
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" });
      await userEvent.click(screen.getByRole("button", { name: "카드 1장 추가" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(1);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    it("merges a photo's cards of one front into one row, joining their backs and senses", async () => {
      const pear = { ...apple, senses: [{ labels: [], meaning: "배나무", examples: [] }] };
      answer({
        status: 200,
        body: {
          cards: [
            card,
            { ...card, answer: "서울특별시" },
            { ...card, answer: "서울" },
            apple,
            { ...apple, front: "Apple", senses: [...apple.senses, ...pear.senses] },
          ],
        },
      });
      await choose(1);
      expect(
        await screen.findByRole("heading", { name: "카드 2장을 만들었어요" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "수도 편집" })).toHaveTextContent(
        "서울 서울특별시",
      );
      expect(screen.getByRole("button", { name: "apple 편집" })).toHaveTextContent(
        "apple[명]사과사과나무배나무",
      );
    });
    it("heads identify cards as 판별 apart from the page's own, left out until checked", async () => {
      answer({ status: 200, body: { cards: [card, identify] } });
      await choose(1);
      await screen.findByRole("heading", { name: "카드 2장을 만들었어요" });
      expect(screen.getByRole("heading", { name: "도시 1" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "판별 · 도시 1" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "수도는? 선택" })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: "수도 선택" })).toBeChecked();
      expect(screen.getByRole("button", { name: "카드 1장 추가" })).toBeInTheDocument();
    });
    it("remembers each section's form for the deck it saved into, and takes it when that deck is chosen", async () => {
      answer(words);
      await choose(1);
      await screen.findByRole("heading", { name: "단어를 찾았어요" });
      await userEvent.click(
        within(await openMenu("과일", "앞면에 단어")).getByRole("menuitemradio", {
          name: "앞면에 뜻",
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "카드 1장 추가" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      cleanup();
      answer(words);
      await choose(1);
      await screen.findByRole("heading", { name: "단어를 찾았어요" });
      // The deck the import opens on takes its remembered form.
      expect(screen.getByRole("button", { name: "과일 카드 모양, 앞면에 뜻" })).toBeInTheDocument();
      // A new deck has no remembered form and keeps the one set; choosing the deck again takes its own.
      await userEvent.click(screen.getByRole("button", { name: "단어장" }));
      await userEvent.click(screen.getByRole("radio", { name: "새 노트" }));
      await userEvent.click(
        within(await openMenu("과일", "앞면에 뜻")).getByRole("menuitemradio", {
          name: "앞면에 단어",
        }),
      );
      expect(
        screen.getByRole("button", { name: "과일 카드 모양, 앞면에 단어" }),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "새 노트" }));
      await userEvent.click(screen.getByRole("radio", { name: "단어장" }));
      expect(screen.getByRole("button", { name: "과일 카드 모양, 앞면에 뜻" })).toBeInTheDocument();
    });
    it("reads a page left unread on through two cursors with the same photo while it shows reading, appending its cards without repeats and counting the photo once", async () => {
      const river = { ...card, front: "강", answer: "한강" };
      const bodies: unknown[] = [];
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const answers = [
        { cards: [card], partial: true, cursor: "first" },
        { cards: [{ ...card, front: " 수도" }, river], partial: true, cursor: "second" },
        { cards: [], partial: false },
      ];
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
          const body: unknown = await request.json();
          bodies.push(body);
          if (bodies.length === 2) await held;
          return HttpResponse.json(answers[bodies.length - 1]);
        }),
      );
      await choose(1);
      await waitFor(() => {
        expect(bodies).toHaveLength(2);
      });
      expect(screen.getByRole("heading", { name: "카드를 찾고 있어요" })).toBeInTheDocument();
      expect(document.querySelector('img[src*="knowno-thinking"]')).not.toBeNull();
      release();
      expect(
        await screen.findByRole("heading", { name: "카드 2장을 만들었어요" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("checkbox", { name: "수도 선택" })).toHaveLength(1);
      expect(screen.getByRole("checkbox", { name: "강 선택" })).toBeInTheDocument();
      expect(bodies.map((body) => field(body, "cursor"))).toEqual([undefined, "first", "second"]);
      expect(new Set(bodies.map((body) => field(body, "image"))).size).toBe(1);
      expect(bodies.filter((body) => field(body, "cursor") === undefined)).toHaveLength(1);
      expect(screen.queryByText("사진의 일부만 읽었어요")).not.toBeInTheDocument();
    });
    it("ends a page's reading at a 410 with the retryable service failure, and a retry reads it from the start, keeping the cards read so far", async () => {
      const bodies: unknown[] = [];
      const answers = [
        HttpResponse.json({ cards: [card], partial: true, cursor: "stale" }),
        HttpResponse.json({ error: "cursor_expired" }, { status: 410 }),
        HttpResponse.json({ cards: [{ ...card, front: "강", answer: "한강" }] }),
      ];
      server.use(
        http.post(`${supabaseUrl}/functions/v1/extract-cards`, async ({ request }) => {
          bodies.push(await request.json());
          return answers[bodies.length - 1];
        }),
      );
      await choose(1);
      expect(await screen.findByText(describeFailure({ kind: "service" }))).toBeInTheDocument();
      expect(bodies).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(
        await screen.findByRole("heading", { name: "카드 2장을 만들었어요" }),
      ).toBeInTheDocument();
      expect(bodies.map((body) => field(body, "cursor"))).toEqual([undefined, "stale", undefined]);
      expect(screen.getByRole("checkbox", { name: "수도 선택" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "강 선택" })).toBeInTheDocument();
    });
    it("collapses and expands each photo's group from its header, leaving the other photos' rows", async () => {
      answer(read, { status: 200, body: { cards: [{ ...card, front: "강", answer: "한강" }] } });
      await choose(2);
      const first = await screen.findByRole("button", { name: "사진 1, 카드 1장" });
      const second = screen.getByRole("button", { name: "사진 2, 카드 1장" });
      expect(first).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("checkbox", { name: "수도 선택" })).toBeInTheDocument();
      await userEvent.click(first);
      expect(first).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("checkbox", { name: "수도 선택" })).not.toBeInTheDocument();
      expect(second).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("checkbox", { name: "강 선택" })).toBeInTheDocument();
      // A collapsed group's cards are still saved.
      expect(screen.getByRole("button", { name: "카드 2장 추가" })).toBeInTheDocument();
      await userEvent.click(first);
      expect(first).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("checkbox", { name: "수도 선택" })).toBeInTheDocument();
    });
    it("states the deck the cards go into, chooses a new deck from its name, and names it on saving", async () => {
      answer(read);
      await choose(1);
      await screen.findByRole("heading", { name: "카드 1장을 만들었어요" });
      expect(screen.getByText(/에 추가돼요$/u)).toHaveTextContent(/^노트 '단어장'에 추가돼요$/u);
      await userEvent.click(screen.getByRole("button", { name: "단어장" }));
      const chooser = screen.getByRole("radiogroup", { name: "추가할 노트" });
      expect(within(chooser).getByRole("radio", { name: "단어장" })).toBeChecked();
      await userEvent.click(within(chooser).getByRole("radio", { name: "새 노트" }));
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      expect(screen.getByText(/에 추가돼요$/u)).toHaveTextContent(/^새 노트에 추가돼요$/u);
      await userEvent.click(screen.getByRole("button", { name: "카드 1장 추가" }));
      expect(screen.getByRole("heading", { name: "새 노트" })).toBeInTheDocument();
      expect(db.rows.decks).toHaveLength(1);
      await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "도시들");
      await userEvent.click(screen.getByRole("button", { name: "만들기" }));
      await waitFor(() => {
        expect(db.rows.cards).toHaveLength(1);
      });
      const made = db.rows.decks.find((row) => row.name === "도시들");
      expect(made).toBeDefined();
      expect(db.rows.cards[0]?.deck_id).toBe(made?.id);
    });
  });
});
