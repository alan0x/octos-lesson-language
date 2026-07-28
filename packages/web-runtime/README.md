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
