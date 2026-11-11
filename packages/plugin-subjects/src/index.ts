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
