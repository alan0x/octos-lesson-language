/** The math plugin's manifest. It imports nothing, so the core can read it (decision 0013 §3). */
export const MATH_PLUGIN_MANIFEST = {
  id: "math",
  // 0.2.0: the number line (decision 0013).
  version: "0.2.0",
  // Every subject plugin depends on the shared tools (decision 0012).
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;
