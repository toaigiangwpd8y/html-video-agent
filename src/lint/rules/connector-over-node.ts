import { insideDepth, sharesTree } from "../geometry.js";
import type { LayoutIssue, LintElement, LintFrame, LintRect, LintRule } from "../types.js";
import { elementsById, sceneIdsOf } from "./support.js";

/** Nodes a connector must not be drawn across: painted boxes, media, and labels. */
const isNode = (element: LintElement): element is LintElement & { rect: LintRect } =>
  Boolean(element.rect) &&
  !element.ignored &&
  element.opacity > 0.9 &&
  element.role !== "connector" &&
  (element.opaque || element.role === "text") &&
  element.rect!.width * element.rect!.height >= 400;

function findCrossings(frame: LintFrame, tolerancePx: number): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const byId = elementsById(frame);
  const connectors = frame.elements.filter(
    (element): element is LintElement & { connector: NonNullable<LintElement["connector"]> } =>
      element.role === "connector" &&
      Boolean(element.connector) &&
      !element.ignored &&
      !element.allowConnectorOverlap &&
      element.opacity > 0,
  );
  const nodes = frame.elements.filter(isNode);
  for (const connector of connectors) {
    const strokeBudget = tolerancePx + connector.connector.strokeWidth / 2;
    for (const node of nodes) {
      if (sharesTree(byId, connector.id, node.id)) continue;
      const depths = connector.connector.points
        .map((point) => insideDepth(point, node.rect))
        .filter((depth) => depth > strokeBudget);
      if (!depths.length) continue;
      const depth = Math.round(Math.max(...depths));
      issues.push({
        code: "connector_over_node",
        severity: "error",
        frame: frame.frame,
        timeSeconds: frame.timeSeconds,
        sceneIds: sceneIdsOf(connector, node),
        elementIds: [connector.id, node.id],
        selectors: [connector.selector, node.selector],
        message: `Connector ${connector.selector} is drawn across ${node.selector}.`,
        expected: "connector centreline stops at the node edge",
        actual: `path runs ${depth}px inside the node box`,
        rects: [node.rect],
        fixHint: "Route the shaft through the gap between nodes, or mark an intentional overlap with data-layout-allow-connector-overlap.",
      });
    }
  }
  return issues;
}

/** A connector shaft or arrowhead drawn across the box of a node it is not anchored to. */
const rule: LintRule = {
  code: "connector_over_node",
  title: "Connector drawn across a node",
  severity: "error",
  applicable: (frame) => frame.elements.some((element) => element.role === "connector" && Boolean(element.connector)),
  evaluate: (frame, ctx) => findCrossings(frame, ctx.tolerancePx),
};

export default rule;
