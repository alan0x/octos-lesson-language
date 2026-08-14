# OLL Web Runtime

Browser-side reference Runtime for Canonical OLL. It combines the DOM-free Player Core with the reusable DOM/SVG infinite-board renderer that is exercised by the playback Harness.

## Public boundary

Production code imports the stable surface from `octos-lesson-language/web-runtime`:

```ts
import {
  BrowserLessonSession,
  LocalPlaybackStore,
  mountInfiniteBoard,
  parseCanonicalJsonl,
} from "octos-lesson-language/web-runtime";
import "octos-lesson-language/web-runtime/styles.css";

const events = parseCanonicalJsonl(source);
const mounted = mountInfiniteBoard(viewport, resolveImageAsset);
const session = new BrowserLessonSession(
  events,
  new LocalPlaybackStore(),
  `learn:${events[0].lesson_id}`,
);

const unsubscribe = session.subscribe(() => {
  mounted.view.render(session.projection.board, session.currentOperation);
});
```

For a lesson that is still arriving, start with the accepted `lesson.open`
prefix and enable incremental playback:

```ts
const session = new BrowserLessonSession(
  [openEvent],
  new LocalPlaybackStore(),
  `learn:${openEvent.lesson_id}`,
  { incremental: true },
);

session.play();
session.appendEvents(validatedStepEvents);
session.appendEvents([closeEvent]);
```

At the current end of an unclosed program the session reports `waiting`.
Appending an identical sequence is idempotent; gaps, conflicting retries and
events after `lesson.close` are rejected atomically.

The host owns the page, lesson acquisition, learner/session identity, errors, TTS, avatar, controls and product persistence policy. The Runtime owns deterministic playback, board layout, DOM/SVG rendering, camera behavior and incremental node updates. Image URLs and region metadata enter through `ImageAssetResolver`; the Runtime does not fetch private assets itself.

`mountInfiniteBoard()` creates only the internal board layers inside the supplied viewport. Host overlays such as narration, controls and the Octos avatar remain untouched. Call `mounted.destroy()` when unmounting the page.

The board exposes the integration boundary used by optional input layers:

- `getCameraState()` reads the camera actually visible during a transition;
- `subscribeCamera()` reports target and intermediate camera frames;
- `boardToViewport()` / `viewportToBoard()` convert stable board coordinates;
- `setInputOwner()` explicitly hands pointer/wheel input to the Runtime, ink, or a future course-object interaction.

The optional `octos-lesson-language/ink-runtime` uses only this public boundary. Do not statically import it on an ordinary lesson route; load its JavaScript and stylesheet when the learner enables writing.

Hosts with persistent overlays should call
`mounted.view.setViewportInsets({ top, right, bottom, left })`. Automatic
teaching focus is then composed inside the unobstructed rectangle instead of
the raw canvas viewport. The method also reframes the current teaching target,
so it can be called from a `ResizeObserver`.

## Teaching clock

Continuous playback has one content-aware teaching pace; there is no separate
legacy or instant playback mode. The Runtime derives a minimum reading budget
for each narration from its CJK characters, Latin words, mathematical tokens,
punctuation and `delivery`. Visible board actions receive delays based on their
operation and content, and Beat/Step boundaries add short classroom pauses.
Board work performed during speech consumes the same narration budget, so the
two proceed in parallel instead of being timed twice. A host using generated
audio can select `narrationTiming: "external"`, call `startNarration(beatId)`
when playback really begins, and call `completeNarration(beatId)` when it ends.
This keeps `during_speech` animation behind the real audio-start boundary.

`pause()` preserves the remaining wait, `setSpeed()` rescales it, and manual
`step()` / `advanceBeat()` deliberately skip it. A host restoring a completed
lesson for review should advance the session to the available end without
calling `play()`. The Runtime aligns the start and end boundaries but does not
attempt word-level audio synchronization.

## Student variable operations

`setVariable()` remains a host/programmatic update and does not pretend to be
a learner action. For a real slider or geometry gesture, use one shared flow:

1. `beginStudentVariableOperation()` captures the value before the gesture;
2. `updateStudentVariableOperation()` updates the board as often as needed;
3. `commitStudentVariableOperation()` stores one semantic `variable_change`.

The stored operation records the variable, before/after values, control source
and input method. `studentOperations` returns completed operations in sequence.
`LocalPlaybackStore` persists this log separately from the playback checkpoint,
so course replay does not erase learner history and a repeated operation ID is
deduplicated. Pointer samples themselves are never stored.

## After-lesson student tasks

Validated `lesson.tasks` become available only after playback reaches
`lesson.close`. `studentTasks` exposes the current prompt, attempt count, hint,
and completion state. A committed slider or geometry-point operation is judged
against only the first unfinished task; the gesture that completes one task is
not reused as an answer to the next task.

Use `requestStudentTaskHint(taskId)` to reveal the next planned hint and
`retryStudentTask(taskId)` to restore the task variables to their initial
values. Task progress is stored separately from playback checkpoints and
student-operation history, so refresh restores all three without conflating
them.

## Testing API

`octos-lesson-language/web-runtime/testing` exports the real-Chrome teaching Observer and gates. It is intentionally separate from the production surface.

```bash
npm run test:web-runtime
npm run teaching:observe:geometry
```

## Current boundary

The v0.1 Runtime accepts complete Canonical programs and validated incremental
prefixes. The host still owns Authoring validation/normalization, transport and
the decision to append `lesson.close`; the Runtime does not execute partial JSON
tokens or unvalidated model output.
