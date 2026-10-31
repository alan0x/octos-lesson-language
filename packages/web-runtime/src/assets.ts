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
  /** Image regions, or for a learner ink snapshot its selections, in fractions of the asset. */
  regions: Record<string, ImageRegionBounds>;
  /**
   * Learner ink snapshots may supply their SVG markup so strokes can be replayed
   * in drawing order. Only plain drawing elements are kept.
   */
  svg?: string;
}

export type ImageAssetResolver = (assetId: string) => ResolvedImageAsset | undefined;
