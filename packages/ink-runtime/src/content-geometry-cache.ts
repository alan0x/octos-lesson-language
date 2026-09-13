import type { AbstractComponent } from "js-draw";

import { coalesceInkOccupiedBounds } from "./occupied-bounds.js";
import type { InkSelectionBounds } from "./selection-record.js";

export interface InkContentGeometry {
  component_count: number;
  content_bounds: InkSelectionBounds | null;
  content_bounds_list: InkSelectionBounds[];
}

const EMPTY_GEOMETRY: InkContentGeometry = {
  component_count: 0,
  content_bounds: null,
  content_bounds_list: [],
};

/** Cache expensive exact stroke bounds until durable ink content changes. */
export class InkContentGeometryCache {
  private revision = -1;
  private value = EMPTY_GEOMETRY;

  read(
    revision: number,
    allComponents: readonly AbstractComponent[],
  ): InkContentGeometry {
    if (revision === this.revision) return this.value;
    const exactBounds = allComponents
      .filter((component) => component.isSelectable())
      .map((component) => component.getExactBBox());
    const boundsList = exactBounds.map((bounds) => ({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }));
    const contentBounds = boundsList.length > 0
      ? boundsList.reduce((union, bounds) => {
          const right = Math.max(union.x + union.width, bounds.x + bounds.width);
          const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
          const x = Math.min(union.x, bounds.x);
          const y = Math.min(union.y, bounds.y);
          return { x, y, width: right - x, height: bottom - y };
        })
      : null;
    this.revision = revision;
    this.value = {
      component_count: exactBounds.length,
      content_bounds: contentBounds,
      content_bounds_list: coalesceInkOccupiedBounds(boundsList),
    };
    return this.value;
  }
}
