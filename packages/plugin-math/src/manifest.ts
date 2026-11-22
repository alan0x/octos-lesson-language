/** The math plugin's manifest. It imports nothing, so the core can read it (decision 0013 §3). */
export const MATH_PLUGIN_MANIFEST = {
  id: "math",
  // 0.2.0: the number line (decision 0013). 0.3.0: jump lanes for several jumps on one line (decision 0017).
  // 0.4.0: the fraction model (decision 0021). 0.4.1: grids fill column by column. 0.4.2: a share marks one
  // piece of each part; the program writes a fraction's other form beside its label (0021 amendment 2).
  // 0.5.0: trading tens and ones, the `base_ten_trade` card (decision 0023).
  version: "0.5.0",
  // Every subject plugin depends on the shared tools (decision 0012).
  depends: { shared: "0.1.0" },
  ollCore: ">=0.10.0",
} as const;
