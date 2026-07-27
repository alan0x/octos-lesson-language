export interface ImageRegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResolvedImageAsset {
  src: string;
  intrinsic_width: number;
  intrinsic_height: number;
  regions: Record<string, ImageRegionBounds>;
}

export type ImageAssetResolver = (assetId: string) => ResolvedImageAsset | undefined;

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
  }
};

export const resolveHarnessAsset: ImageAssetResolver = (assetId) => assets[assetId];
