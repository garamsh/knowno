import { createHash } from "node:crypto";

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cardRow, deckRow, uuidOf } from "@/testing/library";
import { testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { FakeStorage } from "@/testing/mocks/storage";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { parseCardContent, parseCells } from "../card-content";
import { AuthoringButton } from "../components/authoring-button";
import { CardEditor } from "../components/card-editor";
import { type Card, parseCardId, parseDeckId } from "../library";
import { prepareImage } from "../prepare-image";
import { prepareSound } from "../prepare-sound";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// jsdom decodes no image and plays no sound: the browser's preparation is substituted, and
// prepare-image.test.ts and prepare-sound.test.ts hold it to the phone's.
vi.mock("../prepare-image", () => ({ prepareImage: vi.fn() }));
vi.mock("../prepare-sound", () => ({ maxSoundMs: 60_000, prepareSound: vi.fn() }));
vi.spyOn(console, "error").mockImplementation(() => undefined);

const deckId = parseDeckId(uuidOf("deck"));
const cardId = parseCardId(uuidOf("card"));
if (!deckId || !cardId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };

/** A JPEG's bytes as the browser prepared one, and an MPEG-4 sound's. */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const digestOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

beforeAll(() => {
  // jsdom makes no object URL and captures no pointer.
  URL.createObjectURL = () => "blob:picked";
  URL.revokeObjectURL = () => undefined;
  HTMLElement.prototype.setPointerCapture = () => undefined;
});

let db: FakePostgrest;
let storage: FakeStorage;
beforeEach(async () => {
  db = new FakePostgrest();
  storage = new FakeStorage(db);
  server.use(...db.handlers, ...storage.handlers);
  setRequestCookies(await signedInCookies());
  db.rows.decks.push(deckRow("deck", "단어장"));
  vi.mocked(prepareImage).mockResolvedValue({
    jpeg: new Blob([jpeg], { type: "image/jpeg" }),
    sha256: digestOf(jpeg),
    width: 400,
    height: 300,
  });
  vi.mocked(prepareSound).mockImplementation((file: Blob) =>
    Promise.resolve({ file, sha256: digestOf(mp4), durationMs: 7000 }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

/** The browser's microphone, which jsdom has none of, answering [getUserMedia]. */
function microphone(getUserMedia: () => Promise<unknown>) {
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
}

/** Opens direct entry and adds a 칸 of [name] after its 글 of both sides. */
async function newCardWith(name: string) {
  await render(() => <AuthoringButton deck={deck} />, {});
  await userEvent.click(screen.getByRole("button", { name: "카드 추가" }));
  await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
  await userEvent.type(screen.getByRole("textbox", { name: "앞면" }), "dog");
  await userEvent.type(screen.getByRole("textbox", { name: "뒷면" }), "개");
  await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "칸 추가" })).getByRole("button", { name }),
  );
}

/** Picks a photo through [label], which prepareImage prepares as 400 by 300. */
async function pickPhoto(label = "앨범에서 고르기") {
  await userEvent.upload(
    screen.getByLabelText(label),
    new File([new Uint8Array([1])], "photo.png", { type: "image/png" }),
  );
  await screen.findByRole("button", { name: "빈칸 추가" });
}

/** The photo's frame in the editor, laid out at 400 by 300 from the page's top left. */
function frame(): HTMLElement {
  const drawn = document.querySelector<HTMLElement>("[data-photo]");
  if (!drawn) throw new Error("no photo drawn");
  vi.spyOn(drawn, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 300));
  return drawn;
}

/** The stored card's 칸 in the database. */
const storedCells = () => parseCells(db.rows.cards[0]?.front) ?? [];

/** Whether the test user's file [id] is still stored: its row and its object. */
const kept = (id: string) => ({
  row: db.rows.media.some((row) => row.id === id),
  object: storage.objects.has(`${testUser.id}/${id}`),
});

describe("a 사진 칸", () => {
  it("asks for a photo before saving, and stores nothing until one is picked", async () => {
    await newCardWith("사진");
    expect(screen.getByRole("heading", { name: "사진" })).toBeInTheDocument();
    expect(screen.getByLabelText("사진 찍기")).toHaveAttribute("capture", "environment");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("사진을 골라 주세요")).toBeInTheDocument();
    expect(db.rows.cards).toEqual([]);
    expect(db.rows.media).toEqual([]);
  });

  it("draws the picked photo whole at its aspect ratio, and stores it as its row, then its file, then the card", async () => {
    await newCardWith("사진");
    await pickPhoto();
    const drawn = frame();
    expect(drawn.style.aspectRatio).toBe("400 / 300");
    expect(drawn.style.backgroundImage).toBe('url("blob:picked")');
    // A photo with no box sits on a side, as the phone's.
    expect(screen.getByRole("group", { name: "보일 면" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    const [photo] = db.rows.media;
    expect(photo).toMatchObject({ kind: "image", mime_type: "image/jpeg", sha256: digestOf(jpeg) });
    const media = String(photo?.id);
    expect(kept(media)).toEqual({ row: true, object: true });
    expect(storedCells()[1]).toMatchObject({
      kind: "placed",
      side: "front",
      block: { kind: "image", media, width: 400, height: 300, boxes: [] },
    });
    const posts = db.requests.filter((request) => request.startsWith("POST"));
    expect(posts.slice(0, 3)).toEqual(["POST media", "POST storage upload", "POST cards"]);
  });

  it("adds a box by '빈칸 추가', moves and resizes it by its tools, and saves its answer without a side", async () => {
    await newCardWith("사진");
    await pickPhoto();
    await userEvent.click(screen.getByRole("button", { name: "빈칸 추가" }));
    expect(screen.getByRole("button", { name: "빈칸 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("group", { name: "보일 면" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "정답 (선택)" }), " 코 ");
    await userEvent.click(screen.getByRole("button", { name: "오른쪽으로 옮기기" }));
    await userEvent.click(screen.getByRole("button", { name: "세로 늘리기" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    const cell = storedCells()[1];
    expect(cell).toMatchObject({ kind: "blank", block: { kind: "image" } });
    const box = cell?.kind === "blank" && cell.block.kind === "image" ? cell.block.boxes[0] : null;
    expect(box?.id).toBe("1");
    expect(box?.answer).toBe("코");
    expect(box?.x).toBeCloseTo(0.4);
    expect(box?.y).toBeCloseTo(0.4);
    expect(box?.w).toBeCloseTo(0.3);
    expect(box?.h).toBeCloseTo(0.25);
  });

  it("draws a box by a drag over the photo, and moves it by a drag on it, against a tap that draws none", async () => {
    await newCardWith("사진");
    await pickPhoto();
    const drawn = frame();
    // A tap draws nothing.
    fireEvent.pointerDown(drawn, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(drawn, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(screen.queryByRole("button", { name: "빈칸 1" })).not.toBeInTheDocument();

    fireEvent.pointerDown(drawn, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(drawn, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(drawn, { clientX: 200, clientY: 150, pointerId: 1 });
    const box = screen.getByRole("button", { name: "빈칸 1" });
    expect(box).toHaveAttribute("aria-pressed", "true");
    /** The box's left, top, width and height in whole percentages of the photo. */
    const mark = () => {
      const style = document.querySelector<HTMLElement>('[data-box="1"]')?.style;
      return [style?.left, style?.top, style?.width, style?.height].map((value) =>
        Math.round(Number.parseFloat(value ?? "")),
      );
    };
    expect(mark()).toEqual([10, 10, 40, 40]);

    fireEvent.pointerDown(box, { clientX: 120, clientY: 90, pointerId: 2 });
    fireEvent.pointerMove(box, { clientX: 160, clientY: 120, pointerId: 2 });
    fireEvent.pointerUp(box, { clientX: 160, clientY: 120, pointerId: 2 });
    expect(mark()).toEqual([20, 20, 40, 40]);
  });

  it("replaces the photo under its boxes, and deletes it at once, offering it back with its boxes", async () => {
    await newCardWith("사진");
    await pickPhoto();
    // The picker's button went with the photo in; the one in its place takes the focus.
    expect(screen.getByLabelText("다른 사진 고르기")).toHaveFocus();
    expect(screen.getByLabelText("다시 찍기")).toHaveAttribute("capture", "environment");
    await userEvent.click(screen.getByRole("button", { name: "빈칸 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "정답 (선택)" }), "Paris");
    const urls = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:second");
    vi.mocked(prepareImage).mockResolvedValueOnce({
      jpeg: new Blob([jpeg], { type: "image/jpeg" }),
      sha256: digestOf(jpeg),
      width: 800,
      height: 400,
    });
    await userEvent.upload(
      screen.getByLabelText("다른 사진 고르기"),
      new File([new Uint8Array([2])], "other.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(frame().style.aspectRatio).toBe("800 / 400");
    });
    expect(frame().style.backgroundImage).toBe('url("blob:second")');
    expect(screen.getByLabelText("다른 사진 고르기")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "빈칸 1" }));
    expect(screen.getByRole("textbox", { name: "정답 (선택)" })).toHaveValue("Paris");

    await userEvent.click(screen.getByRole("button", { name: "사진 삭제" }));
    expect(document.querySelector("[data-photo]")).toBeNull();
    expect(screen.getByLabelText("앨범에서 고르기")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("사진을 삭제했어요");
    // The photo's own URL was revoked as it left; the one put back is drawn from a new one.
    urls.mockReturnValueOnce("blob:back");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(frame().style.backgroundImage).toBe('url("blob:back")');
    expect(screen.getByRole("button", { name: "빈칸 1" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    expect(storedCells()[1]).toMatchObject({
      block: { kind: "image", width: 800, height: 400, boxes: [{ answer: "Paris" }] },
    });
  });

  it("deletes a box at once, focusing the next, and offers it back with its answer", async () => {
    await newCardWith("사진");
    await pickPhoto();
    await userEvent.click(screen.getByRole("button", { name: "빈칸 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "정답 (선택)" }), "A");
    await userEvent.click(screen.getByRole("button", { name: "빈칸 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "빈칸 1" }));
    await userEvent.click(screen.getByRole("button", { name: "빈칸 삭제" }));
    expect(screen.queryByRole("button", { name: "빈칸 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "빈칸 1" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("빈칸을 삭제했어요");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(screen.getByRole("button", { name: "빈칸 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "빈칸 1" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "빈칸 1" }));
    expect(screen.getByRole("textbox", { name: "정답 (선택)" })).toHaveValue("A");
    // With no box left, "빈칸 추가" takes the focus.
    await userEvent.click(screen.getByRole("button", { name: "빈칸 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "빈칸 1" }));
    await userEvent.click(screen.getByRole("button", { name: "빈칸 삭제" }));
    expect(screen.getByRole("button", { name: "빈칸 추가" })).toHaveFocus();
  });

  it("puts a deleted 사진 칸 back drawn from a new URL, its own revoked as it left", async () => {
    await newCardWith("사진");
    await pickPhoto();
    const urls = vi.spyOn(URL, "createObjectURL");
    urls.mockClear().mockReturnValueOnce("blob:back");
    await userEvent.click(screen.getByRole("button", { name: "2번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.queryByRole("heading", { name: "사진" })).not.toBeInTheDocument();
    // The 칸 before it takes the focus, the last one gone.
    expect(screen.getByRole("textbox", { name: "앞면" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(frame().style.backgroundImage).toBe('url("blob:back")');
    expect(urls).toHaveBeenCalledTimes(1);
  });

  it("says a photo the browser cannot read could not be loaded", async () => {
    vi.mocked(prepareImage).mockResolvedValue(null);
    await newCardWith("사진");
    await userEvent.upload(
      screen.getByLabelText("앨범에서 고르기"),
      new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" }),
    );
    expect(
      await screen.findByText("사진을 불러오지 못했어요. 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "빈칸 추가" })).not.toBeInTheDocument();
  });

  it("releases the photo of a refused card, keeps it in the draft, and stores it again on the next save", async () => {
    await newCardWith("사진");
    await pickPhoto();
    const live = db.rows.decks[0];
    if (!live) throw new Error("the deck");
    live.deleted_at = new Date().toISOString();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(
      await screen.findByText("노트를 찾을 수 없어요. 추가할 노트를 다시 골라 주세요."),
    ).toBeInTheDocument();
    expect(db.requests).toContain("POST storage upload");
    expect(db.rows.media).toEqual([]);
    expect(storage.objects.size).toBe(0);

    live.deleted_at = null;
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    const media = String(db.rows.media[0]?.id);
    expect(kept(media)).toEqual({ row: true, object: true });
    expect(storedCells()[1]).toMatchObject({ block: { media } });
  });
});

describe("a stored card's 사진 and 소리", () => {
  // A photo with a box is a blank and holds no side.
  const photoOf = (media: string, boxes: object[] = []) => ({
    type: "image",
    v: 2,
    id: "p",
    payload: { media, width: 4, height: 3, boxes, ...(boxes.length === 0 && { side: "front" }) },
  });
  const soundOf = (media: string) => ({
    type: "audio",
    v: 2,
    id: "s",
    payload: { media, duration_ms: 7000, side: "back" },
  });
  const text = { type: "text", v: 2, id: "f", payload: { front: "dog", back: "개" } };

  /** A file the user stored under [name]'s id. */
  function storedFile(name: string, kind: "image" | "audio" = "image") {
    const id = uuidOf(name);
    db.rows.media.push({
      user_id: testUser.id,
      id,
      kind,
      mime_type: kind === "image" ? "image/jpeg" : "audio/mp4",
      byte_size: 3,
      sha256: "0".repeat(64),
    });
    storage.seed(`${testUser.id}/${id}`);
    return id;
  }

  /** The editor over a stored card of [front], each file drawn from [urls]. */
  async function editing(front: unknown[], urls: Record<string, string> = {}) {
    db.rows.cards.push({
      ...cardRow("card", "deck", "old"),
      front,
      back: [],
      template: "free",
      template_version: 2,
    });
    const content = parseCardContent({ front, back: [], template: "free", templateVersion: 2 });
    if (!content) throw new Error("a fixture did not parse");
    const signed = (block: (typeof content.front)[number]) =>
      (block.kind === "image" || block.kind === "audio") && urls[block.media]
        ? { ...block, url: urls[block.media] }
        : block;
    const card: Card = {
      id: cardId as never,
      deckId: deckId as never,
      createdAt: 0,
      ...content,
      cells: content.cells.map((cell) =>
        cell.kind === "blank" || cell.kind === "placed"
          ? { ...cell, block: signed(cell.block) }
          : cell,
      ),
    };
    const close = vi.fn();
    await render(() => <CardEditor deck={deck} card={card} close={close} />, {});
    return close;
  }

  it("draws a stored photo from its signed URL with its boxes, and saves it kept without uploading", async () => {
    const photo = storedFile("photo");
    const close = await editing(
      [text, photoOf(photo, [{ id: "1", x: 0.1, y: 0.1, w: 0.2, h: 0.2, answer: "코" }])],
      { [photo]: "https://storage.test/photo" },
    );
    expect(frame().style.backgroundImage).toBe('url("https://storage.test/photo")');
    expect(screen.queryByText("사진은 앱에서 볼 수 있어요")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "빈칸 1" }));
    expect(screen.getByRole("textbox", { name: "정답 (선택)" })).toHaveValue("코");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
    expect(db.requests).not.toContain("POST storage upload");
    expect(kept(photo)).toEqual({ row: true, object: true });
    expect(storedCells()[1]).toMatchObject({ block: { media: photo } });
    expect(JSON.stringify(db.rows.cards[0]?.front)).not.toContain("https://storage.test");
  });

  it("releases the file of a 칸 removed from the card, against one the card keeps", async () => {
    const photo = storedFile("photo");
    const sound = storedFile("sound", "audio");
    const close = await editing([text, photoOf(photo), soundOf(sound)]);
    await userEvent.click(screen.getByRole("button", { name: "2번째 칸 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "삭제" }));
    expect(screen.queryByRole("heading", { name: "사진" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(close).toHaveBeenCalled();
    });
    expect([kept(photo), kept(sound)]).toEqual([
      { row: false, object: false },
      { row: true, object: true },
    ]);
  });
});

describe("a 소리 칸", () => {
  it("picks an .m4a or .mp3 file alone where the browser records no AAC, and stores it as audio/mp4", async () => {
    await newCardWith("소리");
    expect(screen.queryByRole("button", { name: "녹음하기" })).not.toBeInTheDocument();
    const input = screen.getByLabelText("파일에서 고르기");
    expect(input).toHaveAttribute("accept", ".m4a,.mp3,audio/mp4,audio/mpeg");
    await userEvent.upload(input, new File([mp4], "voice.m4a", { type: "audio/mp4" }));
    expect(await screen.findByRole("button", { name: "소리 듣기" })).toBeInTheDocument();
    expect(screen.getByText("0:07")).toBeInTheDocument();
    expect(screen.getByLabelText("다른 파일 고르기")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(db.rows.cards).toHaveLength(1);
    });
    const [sound] = db.rows.media;
    expect(sound).toMatchObject({ kind: "audio", mime_type: "audio/mp4" });
    expect(storedCells()[1]).toMatchObject({
      kind: "placed",
      side: "front",
      block: { kind: "audio", media: sound?.id, durationMs: 7000 },
    });
  });

  it("says a sound past the minute or 5 MiB is refused, and deletes one at once by '소리 삭제', offering it back", async () => {
    vi.mocked(prepareSound).mockResolvedValueOnce("tooLarge");
    await newCardWith("소리");
    await userEvent.upload(
      screen.getByLabelText("파일에서 고르기"),
      new File([mp4], "long.m4a", { type: "audio/mp4" }),
    );
    expect(await screen.findByText("60초, 5MB까지인 파일을 골라 주세요")).toBeInTheDocument();
    await userEvent.upload(
      screen.getByLabelText("파일에서 고르기"),
      new File([mp4], "short.m4a", { type: "audio/mp4" }),
    );
    // The pick's input goes with the sound in; the one in its place takes the focus.
    expect(await screen.findByLabelText("다른 파일 고르기")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "소리 삭제" }));
    expect(screen.queryByRole("button", { name: "소리 듣기" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("파일에서 고르기")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("소리를 삭제했어요");
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(screen.getByRole("button", { name: "소리 듣기" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "소리 삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByText("소리를 넣어 주세요")).toBeInTheDocument();
  });

  it("records where the browser records AAC in MPEG-4, for the time it ran, one 칸 at a time", async () => {
    const stopped: string[] = [];
    class Recorder {
      static isTypeSupported = (type: string) => type === "audio/mp4;codecs=mp4a.40.2";
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(
        readonly stream: unknown,
        readonly options: { mimeType: string },
      ) {}
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        stopped.push(this.options.mimeType);
        this.ondataavailable?.({ data: new Blob([mp4], { type: "audio/mp4" }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", Recorder);
    const track = { stop: vi.fn() };
    microphone(() => Promise.resolve({ getTracks: () => [track] }));
    await newCardWith("소리");
    await userEvent.click(screen.getByRole("button", { name: "+ 칸 추가" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "칸 추가" })).getByRole("button", { name: "소리" }),
    );
    const [first, second] = screen.getAllByRole("button", { name: "녹음하기" });
    if (!first || !second) throw new Error("two 소리 칸");
    await userEvent.click(first);
    expect(await screen.findByText("녹음 중 0:00 / 1:00")).toBeInTheDocument();
    // The one recorder is this 칸's until it stops.
    expect(second).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "녹음 끝내기" }));
    expect(await screen.findByRole("button", { name: "소리 듣기" })).toBeInTheDocument();
    expect(stopped).toEqual(["audio/mp4;codecs=mp4a.40.2"]);
    expect(track.stop).toHaveBeenCalled();
    expect(second).toBeEnabled();
    const [, durationMs] = vi.mocked(prepareSound).mock.calls[0] ?? [];
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(durationMs).toBeLessThanOrEqual(60_000);
  });

  it("says the microphone is refused when the browser denies it", async () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    microphone(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    await newCardWith("소리");
    await userEvent.click(screen.getByRole("button", { name: "녹음하기" }));
    expect(
      await screen.findByText("마이크를 쓸 수 없어요. 설정에서 마이크 접근을 허용해 주세요."),
    ).toBeInTheDocument();
  });
});
