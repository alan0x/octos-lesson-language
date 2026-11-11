/**
 * The chemistry subject plugin's shared layer (decision 0012): its manifest and
 * its Jev subject line. It has no recipes yet; it exists so that Jev can
 * choose the subject (P2) before the first chemistry recipe arrives.
 */

export const CHEMISTRY_PLUGIN_MANIFEST = {
  id: "chemistry",
  version: "0.1.0",
  // Every subject plugin depends on the shared tools (decision 0012).
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;

/** The plugin's choice in the Jev subject question, per language. */
export const CHEMISTRY_SUBJECT_DESCRIPTION = {
  "zh-CN": "化学：物质的组成与结构、化学反应、元素与周期表、溶液、酸和碱",
  "en-US": "Chemistry: matter and its structure, chemical reactions, elements and the periodic table, solutions, acids and bases",
} as const;

/** Recipe builders this plugin offers; none yet. */
export const CHEMISTRY_BUILDERS = {} as const;
