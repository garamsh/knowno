# ADR 0094: Read a photo import of up to fifty photos, three at a time, as an app-level job kept on the device and offered again after a restart

> Status: accepted; its bar above the tab bar and its refusal of a second import superseded by ADR 0183
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0089](0089-import-up-to-ten-photos-into-one-list-read-two-at-a-time-and-state-today-s-limit-before-reading.md) lets one import take up to 10 photos, read at most 2 at a time by a `PhotoBatch` held in the import screen's state. Leaving the screen cancels every open read and loses the photos read so far.
- Issue #331 asks for up to 50 photos in one import, read while the user is elsewhere in the app, and resumed on the next open when the app was closed mid-import, without sending a photo already read again. At about 10 s a photo, 50 photos take minutes, which a user will not watch on one screen.
- The owner decided on 2026-10-20 that the photos are read in the app: no server queue, no OS background task and no migration. Each photo stays one `extract-cards` call, counted by `begin_extraction`.
- Daily limits are Free 30, Pro 100 and Special 200, set by the owner on 2026-10-20 through `admin_set_plan` (issue #331), so on Free today's limit cuts a 50-photo pick before the cap does.
- What bounds the number of reads at once:
  - **The function.** Each photo is its own invocation. `begin_extraction` takes its per-user lock with `pg_advisory_xact_lock` (`supabase/migrations/20261019210000_prompts.sql`), which ends with that call's transaction, before the handler calls the model (`supabase/functions/extract-cards/handler.ts`). Concurrent calls of one user therefore wait on each other only while the photo is counted, not while it is read.
  - **The device.** A read holds its prepared JPEG, at most 6 MiB (`maxPhotoBytes` in `app/lib/photo_import/src/photo.dart`), and the request's base64 body of about four thirds of it. Preparing a picked photo decodes it, at most 2048 px a side as the picker is asked for, on a background isolate.

## Decision

- **Fifty photos.** The album pick and "사진 더 추가" take up to 50 photos in one import, in all (`maxPhotosPerImport`). The camera still takes one. Today's limit is read first and cuts the photos as ADR 0089 decided.
- **Three at a time.** At most 3 photos are read at once (`photosReadAtOnce`), in pick order, the next starting as one ends:
  - against 2, it shortens 50 photos at about 10 s each from about 250 s to about 170 s;
  - the function's lock serialises only the count, so the third call adds a wait of one count, not of one model call;
  - the device holds at most 3 prepared photos and their request bodies, at most about 42 MiB, and decodes one photo at a time, as preparing runs one photo after another;
  - a fourth would save about another 40 s on 50 photos while adding a fourth upload on a phone's connection and a fourth concurrent model call per user, whose rate limits nothing here has measured.
- **An app-level job.** The batch belongs to an `ImportJob`, and the app's one `PhotoImports`, built at the composition site, holds at most one job. The import screen is a view over it:
  - leaving the screen, by the back, a tab or another screen, leaves the job reading;
  - "취소" ends the job and the retake replaces its photo, each asking first (#314's prompt) where the job holds cards; the system back only leaves, and asks nothing.
- **One job at a time.** Starting an import while a job is reading or its list waits is refused with "읽고 있는 사진이 있어요. 끝난 뒤에 새로 가져올 수 있어요." It is not joined: the new import may name another deck, and one job saves into one deck.
- **The bar.** While a job holds photos or a list, a bar above the tab bar, or at the foot of the first-run home, shows the job:
  - "사진 읽는 중 k/n" over a bar of the k photos read while it reads;
  - "카드 n장 확인하기" once its list waits;
  - "읽던 사진 k장 이어서 읽기" while a job a closed app left waits to resume.

  It is one button and a live region, and a tap opens the import screen.
- **Kept on the device.** Each prepared photo is written to a file under the app's support directory, `photo_import/`, and the job keeps no photo in memory: a read loads its photo from the file, and a thumbnail decodes it at most 192 px wide (`thumbnailDecodeWidth`). After every change, the job's state is written beside the photos, replacing the previous state whole: its deck, its photos' source, and each kept photo's file and size with its cards once read. The writes run one at a time: a change during a write is written once it ends, from the job as it is then, so the last state written is the latest, and ending the job waits for the write under way. Saving or ending the job deletes the directory.
- **A photo the device cannot keep.** A photo that cannot be written to its file, as on a full disk, or read back from it, as when the file is gone, fails on its row as `PhotoNotKept`, saying so, with "빼기"; a single photo offers its retake. Sending it again cannot help, so it offers no retry.
- **Resume.** On the next open, the app reads the kept job back:
  - with photos unread, the job waits, and the home screen offers "읽던 사진 k장을 이어서 읽을까요?" with "이어서 읽기" and "버리기"; a dismissal decides nothing, and the bar offers it again;
  - "이어서 읽기" reads only the photos with no cards kept; a photo with its cards kept is never sent again;
  - with every photo read, the list waits in the bar and opens without a call.
- **No OS background task.** Reading pauses while the OS suspends the app and goes on when it returns. A request that fails meanwhile shows on its photo with what its failure offers, as any failed read does.
- No server, function or migration change.
- **Alternatives considered:**
  - **A server queue.** It reads on with the app closed, but it needs storage for photos the function promises not to keep, and a new table and worker. The owner chose in-app reading.
  - **An OS background task.** Both platforms bound how long it may run and when, so it would not read 50 photos reliably, and it adds a native surface on each. The issue rules it out.
  - **Keeping the photos in memory.** 50 prepared photos of up to 6 MiB each are up to 300 MiB, and a restart loses them.
  - **Joining a running import.** It needs a rule for a second import that names another deck. Refusing needs none, and the bar already leads to the running one.
  - **Keeping the list's edits across a restart.** The row checks, edits and forms would need their own kept state. The cards are what cost a read, so they are kept. The list is rebuilt from them, and the device's remembered forms apply as on any list.

## Consequences

- A chapter of up to 50 pages is one import and one save, and the user can study or browse while it reads.
- The cards read so far survive a closed app. A photo whose read was under way when the app closed has no cards kept, so it is read again on resume. If the function had already counted it, it counts again.
- The import screen no longer asks on the system back, since leaving it loses nothing.
- The state on the device carries a version, and a state the app cannot read is ignored as if none were kept.
- A photo left out or replaced keeps its file until the job saves or ends, which deletes them all; the files are bounded by the job's life.
- The bar is a second way into the import, beside the screen that started it. It is built from `photo_import`'s widget in `home/`, which reads `photoImportsProvider`.

## Signs the decision was wrong

- Users pick far fewer than 50 photos, or are cut by today's limit before the cap so often that the cap tells them nothing.
- With 3 calls at a time, the function or the model refuses or fails a call more often than with 2.
- A device runs out of memory while reading.
- Users start a second import while one runs often enough that joining it would have served them better than the refusal.
- Resumed photos fail because their files are gone, as when the OS clears the app's support directory.
