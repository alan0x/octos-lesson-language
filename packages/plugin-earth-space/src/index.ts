/**
 * The earth and space science subject plugin's shared layer (decision 0012): its manifest and
 * its Jev subject line. It has no recipes yet; it exists so that Jev can
 * choose the subject (P2) before the first earth and space recipe arrives.
 */

export const EARTH_SPACE_PLUGIN_MANIFEST = {
  id: "earth_space",
  version: "0.1.0",
  // Every subject plugin depends on the shared tools (decision 0012).
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;

/** The plugin's choice in the Jev subject question, per language. */
export const EARTH_SPACE_SUBJECT_DESCRIPTION = {
  "zh-CN": "地球与宇宙：天气与气候、水循环、岩石与地貌、地球与太阳系",
  "en-US": "Earth and space science: weather and climate, the water cycle, rocks and landforms, Earth and the solar system",
} as const;

/** Recipe builders this plugin offers; none yet. */
export const EARTH_SPACE_BUILDERS = {} as const;
