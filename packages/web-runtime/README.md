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

The host owns the page, lesson acquisition, learner/session identity, errors, TTS, avatar, controls and product persistence policy. The Runtime owns deterministic playback, board layout, DOM/SVG rendering, camera behavior and incremental node updates. Image URLs and region metadata enter through `ImageAssetResolver`; the Runtime does not fetch private assets itself.

`mountInfiniteBoard()` creates only the internal board layers inside the supplied viewport. Host overlays such as narration, controls and the Octos avatar remain untouched. Call `mounted.destroy()` when unmounting the page.

## Testing API

`octos-lesson-language/web-runtime/testing` exports the real-Chrome teaching Observer and gates. It is intentionally separate from the production surface.

```bash
npm run test:web-runtime
npm run teaching:observe:geometry
```

## Current boundary

The v0.1 Runtime accepts a complete, already validated Canonical event program. Appending validated Steps while a lesson is already playing is the next production integration capability; it is not silently simulated by replacing the current program.
