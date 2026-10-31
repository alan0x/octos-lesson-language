import type { ImageAssetResolver, ResolvedImageAsset } from "../../../packages/web-runtime/src/index.js";

const assets: Record<string, ResolvedImageAsset> = {
  "asset-transpiration-control-001": {
    src: "/examples/science-transpiration-v2/assets/transpiration-control.png",
    intrinsic_width: 1536,
    intrinsic_height: 1024,
    regions: {
      "asset-transpiration-control-001#region-leafy-setup": { x: 0.07, y: 0.04, width: 0.40, height: 0.76 },
      "asset-transpiration-control-001#region-droplets": { x: 0.09, y: 0.04, width: 0.37, height: 0.60 },
      "asset-transpiration-control-001#region-leaves": { x: 0.13, y: 0.14, width: 0.28, height: 0.48 },
      "asset-transpiration-control-001#region-control-setup": { x: 0.55, y: 0.04, width: 0.38, height: 0.76 },
      "asset-transpiration-control-001#region-control-bag": { x: 0.57, y: 0.05, width: 0.35, height: 0.63 }
    }
  },
  "asset-learner-ink-card1": {
    src: "/examples/learner-taught-slope-v1/assets/ink-ramps.svg",
    intrinsic_width: 320,
    intrinsic_height: 160,
    regions: {
      "asset-learner-ink-card1#region-gentle-ramp": { x: 0.03, y: 0.62, width: 0.45, height: 0.28 },
      "asset-learner-ink-card1#region-steep-ramp": { x: 0.55, y: 0.15, width: 0.38, height: 0.75 }
    }
  },
  "asset-learner-ink-card3": {
    src: "/examples/learner-taught-slope-v1/assets/ink-fraction.svg",
    intrinsic_width: 200,
    intrinsic_height: 140,
    regions: {
      "asset-learner-ink-card3#region-rise": { x: 0.15, y: 0.02, width: 0.72, height: 0.40 },
      "asset-learner-ink-card3#region-run": { x: 0.15, y: 0.55, width: 0.72, height: 0.40 }
    }
  }
};

export const resolveHarnessAsset: ImageAssetResolver = (assetId) => assets[assetId];
