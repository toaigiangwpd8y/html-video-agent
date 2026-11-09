import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {existsSync, readdirSync} from "node:fs";
import {lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {basename, join, resolve} from "node:path";

const releasePrefix = "https://github.com/Vincentwei1021/video-shotcraft/releases/download/gallery-media/";
const maximumBytes = 150 * 1024 * 1024;

function findExecutable(name, root = process.cwd()) {
  const windows = process.platform === "win32";
  const binary = windows ? `${name}.exe` : name;
  const configured = process.env[`${name.toUpperCase()}_PATH`];
  if (configured && existsSync(configured)) return configured;
  const separator = windows ? ";" : ":";
  for (const directory of (process.env.PATH ?? "").split(separator).filter(Boolean)) {
    const candidate = resolve(directory, binary);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const compositorRoot = resolve(root, "remotion/node_modules/@remotion");
    for (const entry of readdirSync(compositorRoot, {withFileTypes: true})) {
      if (!entry.isDirectory() || !entry.name.startsWith("compositor-")) continue;
      if (windows ? entry.name.includes("darwin") || entry.name.includes("linux") : !entry.name.includes(process.platform)) continue;
      const candidate = resolve(compositorRoot, entry.name, binary);
      if (existsSync(candidate)) return candidate;
    }
  } catch {}
  return undefined;
}

function runTool(executable, args) {
  return new Promise((resolveResult) => {
    execFile(executable, args, {windowsHide: true, timeout: 60_000, maxBuffer: 2_000_000}, (error, stdout, stderr) =>
      resolveResult({ok: !error, stdout: stdout ?? "", stderr: stderr ?? ""}));
  });
}

export async function validatePreviewVideo(file, tools) {
  const found = tools ?? {ffprobePath: findExecutable("ffprobe"), ffmpegPath: findExecutable("ffmpeg")};
  if (!found.ffprobePath || !found.ffmpegPath) {
    throw new Error("Preview validation unavailable: local ffprobe and FFmpeg must be installed; no binary is downloaded.");
  }
  const probe = await runTool(found.ffprobePath, [
    "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames:format=format_name,duration", "-of", "json", file,
  ]);
  if (!probe.ok) throw new Error("Invalid video preview: ffprobe could not read the video stream.");
  let metadata;
  try { metadata = JSON.parse(probe.stdout); }
  catch { throw new Error("Invalid video preview: ffprobe returned invalid metadata."); }
  const video = Array.isArray(metadata.streams) ? metadata.streams.find(stream => stream.codec_type === "video") : undefined;
  if (!video || !Number.isInteger(Number(video.width)) || Number(video.width) < 2 || !Number.isInteger(Number(video.height)) || Number(video.height) < 2) {
    throw new Error("Invalid video preview: no decodable video stream was found.");
  }
  const frameCount = Number(video.nb_read_frames);
  const duration = Number(metadata.format?.duration);
  if (!String(metadata.format?.format_name ?? "").split(",").includes("mov") || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(frameCount) || frameCount < 2) {
    throw new Error("Invalid video preview: release asset is not a multi-frame MP4 video.");
  }
  const decoded = await runTool(found.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  if (!decoded.ok) throw new Error("Invalid video preview: FFmpeg could not decode the video stream.");
  return {codec: video.codec_name, width: Number(video.width), height: Number(video.height), frames: frameCount, durationSeconds: duration};
}

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function isMatchingRecord(record, preview, path, bytes, validation, digest) {
  return record && typeof record === "object" &&
    record.source === preview.source && record.upstreamPath === preview.upstreamPath &&
    record.localPath === path && record.kind === "motion_video" &&
    record.codec === validation.codec && record.width === validation.width && record.height === validation.height &&
    record.sizeBytes === bytes.length && record.sha256 === digest && typeof record.fetchedAt === "string";
}

export async function fetchPreviewAsset(preview, outputDirectory, fetchImpl = fetch, fileOps = {}) {
  if (!preview?.source?.startsWith(releasePrefix)) throw new Error("Preview source is not a Shotcraft gallery release asset");
  const filename = basename(new URL(preview.source).pathname);
  if (!/^[-a-z0-9_.]+\.mp4$/i.test(filename)) throw new Error("Preview release asset must be an MP4 video");
  const response = await fetchImpl(preview.source);
  if (!response.ok) throw new Error(`Preview fetch failed with HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!/video\/|application\/octet-stream/i.test(contentType)) throw new Error(`Preview release asset is not a video (${contentType || "unknown content type"})`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maximumBytes) throw new Error("Preview asset exceeds the 150 MiB fetch limit");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) throw new Error("Preview asset is empty or exceeds the 150 MiB fetch limit");
  const directory = resolve(outputDirectory);
  await mkdir(directory, {recursive: true});
  const stagingDirectory = await mkdtemp(join(directory, ".shotcraft-preview-"));
  const stagedPath = resolve(stagingDirectory, filename);
  const stagedRecordPath = `${stagedPath}.json`;
  const path = resolve(directory, filename);
  const recordPath = `${path}.json`;
  const renameFile = fileOps.rename ?? rename;
  try {
    await writeFile(stagedPath, bytes, {flag: "wx"});
    const validation = await validatePreviewVideo(stagedPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const record = {
      source: preview.source,
      upstreamPath: preview.upstreamPath,
      localPath: path,
      kind: "motion_video",
      codec: validation.codec,
      width: validation.width,
      height: validation.height,
      sizeBytes: bytes.length,
      sha256: digest,
      fetchedAt: new Date().toISOString(),
    };

    const [mediaStat, recordStat] = await Promise.all([exists(path), exists(recordPath)]);
    if (mediaStat && recordStat) {
      if (!mediaStat.isFile() || !recordStat.isFile()) throw new Error("Cached preview pair is inconsistent: media and provenance must be regular files");
      let existingRecord;
      let existingBytes;
      try {
        [existingBytes, existingRecord] = await Promise.all([
          readFile(path),
          readFile(recordPath, "utf8").then(JSON.parse),
        ]);
      } catch {
        throw new Error("Cached preview pair is inconsistent: provenance sidecar is unreadable");
      }
      const existingDigest = createHash("sha256").update(existingBytes).digest("hex");
      if (!isMatchingRecord(existingRecord, preview, path, existingBytes, validation, existingDigest)) {
        throw new Error("Cached preview pair is inconsistent: media checksum or provenance fields do not match");
      }
      if (existingDigest !== digest) throw new Error("Cached preview conflict: fetched bytes differ from the existing release asset");
      return existingRecord;
    }

    // A single artifact is an interrupted prior write; only regular files are safe to discard.
    for (const [orphanPath, orphanStat] of [[path, mediaStat], [recordPath, recordStat]]) {
      if (!orphanStat) continue;
      if (!orphanStat.isFile()) throw new Error("Incomplete cached preview artifact is not a regular file; refusing to remove it");
      await rm(orphanPath, {force: true});
    }

    await writeFile(stagedRecordPath, `${JSON.stringify(record, null, 2)}\n`, {flag: "wx"});
    let mediaPromoted = false;
    let recordPromoted = false;
    try {
      await renameFile(stagedPath, path);
      mediaPromoted = true;
      await renameFile(stagedRecordPath, recordPath);
      recordPromoted = true;
    } catch (error) {
      // Remove only the exact files from this transaction, including an operation that
      // completed the rename before surfacing an error.
      if (recordPromoted || (await exists(recordPath))?.isFile()) {
        try {
          const currentRecord = JSON.parse(await readFile(recordPath, "utf8"));
          if (currentRecord.sha256 === digest && currentRecord.localPath === path) await rm(recordPath, {force: true});
        } catch {}
      }
      if (mediaPromoted || (await exists(path))?.isFile()) {
        try {
          const currentBytes = await readFile(path);
          if (createHash("sha256").update(currentBytes).digest("hex") === digest) await rm(path, {force: true});
        } catch {}
      }
      throw error;
    }
    return record;
  } finally {
    await rm(stagingDirectory, {recursive: true, force: true});
  }
}
