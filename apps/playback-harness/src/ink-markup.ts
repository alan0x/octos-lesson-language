import type { ImageAssetResolver } from "../../../packages/web-runtime/src/index.js";
import inkCircleA from "../../../examples/learner-taught-slope-v2/assets/ink-circle-a.svg";
import inkFraction from "../../../examples/learner-taught-slope-v2/assets/ink-fraction.svg";
import inkRamps from "../../../examples/learner-taught-slope-v2/assets/ink-ramps.svg";

// Snapshot markup is bundled as text for the browser harness only, so the
// asset table stays importable from Node tests.
const markup: Record<string, string> = {
  "ink-snap:card1@v4": inkRamps,
  "ink-snap:card2-circle-a@v4": inkCircleA,
  "ink-snap:card3@v4": inkFraction,
};

/** Adds learner ink markup to a resolver so strokes can replay in drawing order. */
export function withInkMarkup(resolve: ImageAssetResolver): ImageAssetResolver {
  return (assetId) => {
    const asset = resolve(assetId);
    return asset && markup[assetId] ? { ...asset, svg: markup[assetId] } : asset;
  };
}
