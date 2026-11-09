import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { exists } from "../harness/fs.js";

export type BacklotChangeCallback = (event: { type: string; file?: string }) => void;

export class BacklotWatcher {
  private watchers: FSWatcher[] = [];
  private listeners: Set<BacklotChangeCallback> = new Set();
  private debounceTimer: any = null;
  private pendingFiles: Set<string> = new Set();

  constructor(private root: string) {}

  public async start(): Promise<void> {
    const preproductionRoot = resolve(this.root, ".video");
    const targets = [
      resolve(this.root, ".video/candidates"),
      resolve(this.root, ".video/captions"),
      resolve(this.root, ".video/revisions"),
      resolve(this.root, ".video/voiceover"),
      resolve(this.root, "assets"),
      resolve(this.root, "output"),
      resolve(this.root, "remotion/generated"),
      resolve(this.root, "hyperframes/projects"),
    ];

    // Watch the state root shallowly so cache and model trees remain untouched.
    if (await exists(preproductionRoot)) this.watchPath(preproductionRoot, false);

    for (const target of targets) {
      if (await exists(target)) {
        this.watchPath(target, true);
      }
    }

    // Watch project root for top-level video.json
    try {
      const rootWatcher = watch(this.root, (eventType: string, filename: string | null) => {
        if (filename === "video.json") {
          this.scheduleEmit("video.json");
        }
      });
      this.watchers.push(rootWatcher);
    } catch {
      // Ignored if root cannot be watched directly
    }
  }

  private watchPath(dirPath: string, recursive: boolean): void {
    try {
      const watcher = watch(dirPath, { recursive }, (eventType: string, filename: string | null) => {
        if (filename) {
          this.scheduleEmit(filename);
        } else {
          this.scheduleEmit(dirPath);
        }
      });
      watcher.on?.("error", () => {});
      this.watchers.push(watcher);
    } catch {
      // Best-effort watcher attach
    }
  }

  private scheduleEmit(filename: string): void {
    this.pendingFiles.add(filename);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      const files = Array.from(this.pendingFiles).join(", ");
      this.pendingFiles.clear();
      this.notifyListeners({ type: "change", file: files });
    }, 150);
  }

  public subscribe(cb: BacklotChangeCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notifyListeners(event: { type: string; file?: string }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Suppress listener errors
      }
    }
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignored
      }
    }
    this.watchers = [];
    this.listeners.clear();
  }
}
