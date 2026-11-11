/**
 * Every subject plugin's manifest and Jev subject line, by plugin ID. Hosts
 * build the Jev subject question from the plugins a lesson generator reports
 * as installed (P2); the shared plugin has no subject line because it is
 * always included.
 */
import { MATH_PLUGIN_MANIFEST, MATH_SUBJECT_DESCRIPTION } from "../../plugin-math/src/index.js";
import { PHYSICS_PLUGIN_MANIFEST, PHYSICS_SUBJECT_DESCRIPTION } from "../../plugin-physics/src/index.js";
import { CHEMISTRY_PLUGIN_MANIFEST, CHEMISTRY_SUBJECT_DESCRIPTION } from "../../plugin-chemistry/src/index.js";
import { BIOLOGY_PLUGIN_MANIFEST, BIOLOGY_SUBJECT_DESCRIPTION } from "../../plugin-biology/src/index.js";
import { EARTH_SPACE_PLUGIN_MANIFEST, EARTH_SPACE_SUBJECT_DESCRIPTION } from "../../plugin-earth-space/src/index.js";

export type SubjectLanguage = "zh-CN" | "en-US";

export interface SubjectPlugin {
  manifest: { id: string; version: string; depends: Readonly<Record<string, string>> };
  description: Readonly<Record<SubjectLanguage, string>>;
}

/** Subject plugins in a fixed order (decision S12). */
export const SUBJECT_PLUGINS: readonly SubjectPlugin[] = [
  { manifest: MATH_PLUGIN_MANIFEST, description: MATH_SUBJECT_DESCRIPTION },
  { manifest: PHYSICS_PLUGIN_MANIFEST, description: PHYSICS_SUBJECT_DESCRIPTION },
  { manifest: CHEMISTRY_PLUGIN_MANIFEST, description: CHEMISTRY_SUBJECT_DESCRIPTION },
  { manifest: BIOLOGY_PLUGIN_MANIFEST, description: BIOLOGY_SUBJECT_DESCRIPTION },
  { manifest: EARTH_SPACE_PLUGIN_MANIFEST, description: EARTH_SPACE_SUBJECT_DESCRIPTION },
];

/** The subject line of a plugin in a language (English for other languages); undefined for unknown IDs and shared. */
export function subjectDescription(id: string, language: string): string | undefined {
  const plugin = SUBJECT_PLUGINS.find((entry) => entry.manifest.id === id);
  if (!plugin) return undefined;
  return language.toLowerCase().startsWith("zh") ? plugin.description["zh-CN"] : plugin.description["en-US"];
}

/** Probability thresholds from the P0 baseline (70 of 78 lesson requests scoped correctly). */
export const SUBJECT_THRESHOLDS = { top: 0.6, second: 0.05 } as const;

/**
 * The Jev subject question (subject plan §5.2): the given plugins' subject
 * lines plus `none` (no installed subject applies) and `unclear` (cannot
 * tell). Plugins without a subject line, such as `shared`, are not choices.
 */
export function subjectQuestion(pluginIds: readonly string[], language: string) {
  const criteria: Record<string, string> = {};
  for (const id of pluginIds) {
    const description = subjectDescription(id, language);
    if (description) criteria[id] = description;
  }
  criteria.none = "不属于以上任何学科，例如历史、语言、文学、艺术或日常生活问题";
  criteria.unclear = "无法判断属于哪个学科，例如只说'这道题'而看不到题目内容";
  return {
    type: "choice" as const,
    instructions: "判断这个学习请求属于哪个学科。请求结合图片或 state.current_lesson 才能看懂时，按它们判断",
    criteria,
  };
}

export interface SubjectSelection {
  plugins: string[];
  confidence: number;
}

/**
 * Plugins from Jev's subject probabilities: the top subject at or above T1,
 * plus the second subject at or above T2; `none` at or above T1 selects the
 * shared tools alone. Below T1, or when `unclear` wins, nothing is selected.
 */
export function selectSubjectPlugins(
  probabilities: Readonly<Record<string, number>> | undefined,
  pluginIds: readonly string[],
  thresholds: { top: number; second: number } = SUBJECT_THRESHOLDS,
): SubjectSelection | undefined {
  if (!probabilities) return undefined;
  const ranked = Object.entries(probabilities)
    .filter(([, probability]) => typeof probability === "number" && Number.isFinite(probability))
    .sort(([, a], [, b]) => b - a);
  const top = ranked[0];
  if (!top || top[1] < thresholds.top || top[0] === "unclear") return undefined;
  if (top[0] === "none") return { plugins: ["shared"], confidence: top[1] };
  if (!pluginIds.includes(top[0])) return undefined;
  const second = ranked.slice(1).find(([id]) => pluginIds.includes(id) && id !== "none" && id !== "unclear");
  return { plugins: second && second[1] >= thresholds.second ? [top[0], second[0]] : [top[0]], confidence: top[1] };
}
