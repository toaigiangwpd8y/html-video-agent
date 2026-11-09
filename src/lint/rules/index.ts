import type { LintRule } from "../types.js";
import assetNotReady from "./asset-not-ready.js";
import connectorOverNode from "./connector-over-node.js";
import copyParity from "./copy-parity.js";
import objectOverText from "./object-over-text.js";
import outOfFrame from "./out-of-frame.js";
import textClipped from "./text-clipped.js";
import textOverlap from "./text-overlap.js";
import textTooSmall from "./text-too-small.js";

/** Every hardcoded layout check. Add a rule module and append it here. */
export const lintRules: LintRule[] = [
  textOverlap,
  objectOverText,
  connectorOverNode,
  outOfFrame,
  textClipped,
  textTooSmall,
  assetNotReady,
  copyParity,
];
