/**
 * The biology subject plugin's shared layer (decision 0012): its manifest and
 * its Jev subject line. It has no recipes yet; it exists so that Jev can
 * choose the subject (P2) before the first biology recipe arrives.
 */

export const BIOLOGY_PLUGIN_MANIFEST = {
  id: "biology",
  version: "0.1.0",
  // Every subject plugin depends on the shared tools (decision 0012).
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;

/** The plugin's choice in the Jev subject question, per language. */
export const BIOLOGY_SUBJECT_DESCRIPTION = {
  "zh-CN": "生物：细胞、遗传与进化、生态系统、人体、植物与动物",
  "en-US": "Biology: cells, heredity and evolution, ecosystems, the human body, plants and animals",
} as const;

/** Recipe builders this plugin offers; none yet. */
export const BIOLOGY_BUILDERS = {} as const;
