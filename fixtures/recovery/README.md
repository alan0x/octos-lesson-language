# Recovery fixtures

`manifest.json` is the shared recovery-case inventory. Player Core executes
R-001 through R-006 in CI. R-007 is marked `covered_in_octos_web`: TTS is
outside the headless language core, and the product integration test proves
that a configured-provider synthesis failure keeps accessible narration and
lesson playback independent.

Keeping the external case in the manifest makes the Phase 1/3 boundary explicit.
A fixed real-browser E2E is still required before Phase 3 exits.
