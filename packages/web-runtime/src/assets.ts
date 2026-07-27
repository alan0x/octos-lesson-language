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
