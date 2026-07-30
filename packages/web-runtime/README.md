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

## Teaching clock

Continuous playback has one content-aware teaching pace; there is no separate
legacy or instant playback mode. The Runtime derives a minimum reading budget
for each narration from its CJK characters, Latin words, mathematical tokens,
punctuation and `delivery`. Visible board actions receive delays based on their
operation and content, and Beat/Step boundaries add short classroom pauses.
Board work performed during speech consumes the same narration budget, so the
two proceed in parallel instead of being timed twice.

`pause()` preserves the remaining wait, `setSpeed()` rescales it, and manual
`step()` / `advanceBeat()` deliberately skip it. A host restoring a completed
lesson for review should advance the session to the available end without
calling `play()`. TTS may run alongside this clock, but the Runtime does not
attempt millisecond-level audio synchronization.

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
