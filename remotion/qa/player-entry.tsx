import React,{useEffect,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Player,type PlayerRef} from "@remotion/player";
import {GeneratedVideo} from "../generated/Video";
import project from "../generated/project.json";
import assetManifest from "../generated/asset-manifest.json";
import {extractLintFrame} from "../core/lint-extract";
import type {VideoProject} from "../../src/core/types";
import type {AssetManifest} from "../../src/harness/assets";
import type {LintFrame} from "../../src/lint/types";

/** Harness-owned browser entry used by the deterministic layout lint probe.
 *
 * It is not generated source: the probe bundles this file once, mounts the Remotion `Player`
 * over the same `GeneratedVideo` the renderer uses, and exposes seek/extract hooks so Node can
 * sample real rendered geometry over the loopback bundle.
 */

declare global {
  interface Window {
    __LINT_READY__?: boolean;
    __LINT_SEEK__?: (frame: number) => Promise<void>;
    __LINT_EXTRACT__?: (frame: number, timeSeconds: number) => LintFrame;
  }
}

const typedProject = project as VideoProject;
const typedAssetManifest = assetManifest as AssetManifest;

/** Resolves after the browser has committed layout and painted at least one more frame. */
function settle(): Promise<void> {
  const {promise, resolve} = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return promise;
}

const Host: React.FC = () => {
  const ref = useRef<PlayerRef>(null);

  useEffect(() => {
    let alive = true;
    window.__LINT_SEEK__ = async (frame: number) => {
      ref.current?.seekTo(frame);
      await settle();
    };
    window.__LINT_EXTRACT__ = (frame: number, timeSeconds: number) =>
      extractLintFrame({frame, timeSeconds, innerWidth: window.innerWidth, innerHeight: window.innerHeight});
    // Mark ready only after mount and the first painted frame; wait for fonts so geometry is final.
    void (async () => {
      await settle();
      try {
        await document.fonts.ready;
      } catch {
        /* Font loading API unavailable; geometry is still measurable. */
      }
      await settle();
      if (alive) window.__LINT_READY__ = true;
    })();
    return () => {
      alive = false;
      delete window.__LINT_READY__;
      delete window.__LINT_SEEK__;
      delete window.__LINT_EXTRACT__;
    };
  }, []);

  const width = typedProject.meta.width;
  const height = typedProject.meta.height;
  return (
    <div
      data-lint-canvas
      data-width={width}
      data-height={height}
      style={{position: "relative", width, height, overflow: "hidden"}}
    >
      <Player
        ref={ref}
        component={GeneratedVideo}
        inputProps={{project: typedProject, assetManifest: typedAssetManifest}}
        durationInFrames={typedProject.meta.durationsInFrames}
        compositionWidth={width}
        compositionHeight={height}
        fps={typedProject.meta.fps}
        controls={false}
        autoPlay={false}
        style={{width, height}}
      />
    </div>
  );
};

const container = document.getElementById("root");
if (!container) throw new Error("Layout probe entry requires a #root container.");
createRoot(container).render(<Host />);
