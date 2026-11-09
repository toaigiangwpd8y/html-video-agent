import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { exec } from "node:child_process";
import { collectBacklotState, handleHitlApprove, handleHitlClarify, handleHitlRequestChanges,handleHitlReopen,handleHitlDuration } from "./api.js";
import { BacklotWatcher } from "./watcher.js";
import { handleExplorerRequest } from "../app-explorer/http.js";
import { createAppExplorerReaders } from "../app-explorer/service.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface ServerOptions {
  root?: string;
  port?: number;
  openBrowser?: boolean;
}

export interface RunningBacklotServer {
  server: Server;
  port: number;
  url: string;
  watcher: BacklotWatcher;
  stop: () => Promise<void>;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolvePromise(data));
    req.on("error", (err) => rejectPromise(err));
  });
}

function serveStreamWithRange(
  filePath: string,
  totalSize: number,
  mimeType: string,
  req: IncomingMessage,
  res: ServerResponse
): void {
  const isHead = req.method === "HEAD";
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mimeType,
    });
    if (!isHead) {
      createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.end();
    }
  } else {
    res.writeHead(200, {
      "Content-Length": totalSize,
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
    });
    if (!isHead) {
      createReadStream(filePath).pipe(res);
    } else {
      res.end();
    }
  }
}

function resolveWebDirectory(root: string): string {
  const distCandidate = resolve(root, "dist/src/backlot/web");
  if (existsSync(distCandidate)) {
    return distCandidate;
  }
  const srcCandidate = resolve(root, "src/backlot/web");
  if (existsSync(srcCandidate)) {
    return srcCandidate;
  }
  return srcCandidate;
}

function safeExplorerDashboardUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export async function startBacklotServer(options: ServerOptions = {}): Promise<RunningBacklotServer> {
  const root = resolve(options.root ?? process.cwd());
  const requestedPort = options.port ?? 4200;
  const webDir = resolveWebDirectory(root);
  let boundPort:number|undefined;

  const watcher = new BacklotWatcher(root);
  await watcher.start();
  const explorerReaders = createAppExplorerReaders();

  const server = createServer(async (req, res) => {
    const urlObj = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(urlObj.pathname);

    res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Referrer-Policy","no-referrer");

    const localHosts=new Set([`localhost:${boundPort}`,`127.0.0.1:${boundPort}`]);
    const localOrigins=new Set([`http://localhost:${boundPort}`,`http://127.0.0.1:${boundPort}`]);
    if(boundPort!==undefined&&req.headers.host&&!localHosts.has(req.headers.host.toLowerCase())){res.writeHead(403);res.end("Forbidden host");return;}
    if(req.headers.origin&&!localOrigins.has(req.headers.origin)){res.writeHead(403);res.end("Forbidden origin");return;}

    if (req.method === "OPTIONS") {
      res.writeHead(403);
      res.end();
      return;
    }

    if (pathname === "/api/explorer/dashboard") {
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: "Read-only API" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ dashboardUrl: safeExplorerDashboardUrl(process.env.APP_EXPLORER_AGENT_BROWSER_DASHBOARD_URL) }));
      return;
    }

    if (pathname.startsWith("/api/explorer/")) {
      try {
        await handleExplorerRequest(req, res, { root, url: urlObj, readers: explorerReaders });
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/state") {
      try {
        const state = await collectBacklotState(root);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(state));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

      const unsubscribe = watcher.subscribe((evt) => {
        res.write(`data: ${JSON.stringify(evt)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/hitl/approve") {
      try {
        if(!req.headers.origin||!localOrigins.has(req.headers.origin)||req.headers["content-type"]?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new Error("HITL approval requires a same-origin loopback JSON request.");
        const bodyText = await readRequestBody(req);
        const payload = JSON.parse(bodyText);
        const result = await handleHitlApprove(root, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/hitl/clarify") {
      try {
        if(!req.headers.origin||!localOrigins.has(req.headers.origin)||req.headers["content-type"]?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new Error("HITL clarification requires a same-origin loopback JSON request.");
        const bodyText = await readRequestBody(req);
        const payload = JSON.parse(bodyText);
        const result = await handleHitlClarify(root, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/hitl/request-changes") {
      try {
        if(!req.headers.origin||!localOrigins.has(req.headers.origin)||req.headers["content-type"]?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new Error("HITL change requests require a same-origin loopback JSON request.");
        const bodyText = await readRequestBody(req);
        const payload = JSON.parse(bodyText);
        const result = await handleHitlRequestChanges(root,payload);
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:true,result}));
      } catch (error) {
        res.writeHead(400,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/hitl/reopen") {
      try {
        if(!req.headers.origin||!localOrigins.has(req.headers.origin)||req.headers["content-type"]?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new Error("Checkpoint reopen requires a same-origin loopback JSON request.");
        const payload=JSON.parse(await readRequestBody(req)),result=await handleHitlReopen(root,payload);
        res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({ok:true,result}));
      } catch(error){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));}
      return;
    }

    if (req.method === "POST" && pathname === "/api/hitl/duration") {
      try {
        if(!req.headers.origin||!localOrigins.has(req.headers.origin)||req.headers["content-type"]?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new Error("Duration decision requires a same-origin loopback JSON request.");
        const payload=JSON.parse(await readRequestBody(req)),result=await handleHitlDuration(root,payload);
        res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({ok:true,result}));
      } catch(error){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));}
      return;
    }

    if (
      (req.method === "GET" || req.method === "HEAD") &&
      (pathname.startsWith("/media/") || pathname.startsWith("/assets/") || pathname.startsWith("/output/") || pathname.startsWith("/narration/"))
    ) {
      const relPath = pathname.startsWith("/narration/")
        ? resolve(root,".video/tts-cache",pathname.replace(/^\/narration\//,""))
        : pathname.startsWith("/media/")
        ? pathname.replace(/^\/media\//, "")
        : pathname.replace(/^\//, "");
      let targetFile = pathname.startsWith("/narration/")?relPath:resolve(root, relPath);

      const fromRoot=relative(root,targetFile);
      if (fromRoot===".."||fromRoot.startsWith(`..${sep}`)||fromRoot.startsWith(sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if(pathname.startsWith("/narration/")&&!/^[a-f0-9]{64}\.wav$/i.test(targetFile.split(/[\\/]/).at(-1)??"")){res.writeHead(404);res.end("Narration not found");return;}

      try {
        const rootReal=await realpath(root),targetReal=await realpath(targetFile),realRelative=relative(rootReal,targetReal);
        if(realRelative===".."||realRelative.startsWith(`..${sep}`)||realRelative.startsWith(sep)){res.writeHead(403);res.end("Forbidden symlink");return;}
        targetFile=targetReal;
        const fileStat = await stat(targetFile);
        if (fileStat.isFile()) {
          const ext = extname(targetFile).toLowerCase();
          const mime = MIME_TYPES[ext] ?? "application/octet-stream";
          serveStreamWithRange(targetFile, fileStat.size, mime, req, res);
          return;
        }
      } catch {
        res.writeHead(404);
        res.end("Media not found");
        return;
      }
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const isHead = req.method === "HEAD";
      const targetRel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
      const targetFile = resolve(webDir, targetRel),webRelative=relative(webDir,targetFile);
      if(webRelative===".."||webRelative.startsWith(`..${sep}`)||webRelative.startsWith(sep)){res.writeHead(403);res.end("Forbidden path");return;}

      if (existsSync(targetFile)) {
        try {
          const webReal=await realpath(webDir),targetReal=await realpath(targetFile),realRelative=relative(webReal,targetReal);
          if(realRelative===".."||realRelative.startsWith(`..${sep}`)||realRelative.startsWith(sep)){res.writeHead(403);res.end("Forbidden symlink");return;}
          const fileStat = await stat(targetReal);
          if (fileStat.isFile()) {
            const ext = extname(targetReal).toLowerCase();
            const mime = MIME_TYPES[ext] ?? "application/octet-stream";
            res.writeHead(200, { "Content-Type": mime, "Content-Length": fileStat.size });
            if (!isHead) {
              createReadStream(targetReal).pipe(res);
            } else {
              res.end();
            }
            return;
          }
        } catch {
          // Fall through
        }
      }

      const indexHtml = join(webDir, "index.html");
      if (existsSync(indexHtml)) {
        try {
          const webReal=await realpath(webDir),indexReal=await realpath(indexHtml),realRelative=relative(webReal,indexReal);
          if(realRelative===".."||realRelative.startsWith(`..${sep}`)||realRelative.startsWith(sep)){res.writeHead(403);res.end("Forbidden symlink");return;}
          const fileStat = await stat(indexReal);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": fileStat.size });
          if (!isHead) {
            createReadStream(indexReal).pipe(res);
          } else {
            res.end();
          }
          return;
        } catch {
          // Fall through
        }
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on("error", (err) => rejectPromise(err));
    server.listen(requestedPort, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
      boundPort=actualPort;
      const url = `http://127.0.0.1:${actualPort}`;

      if (options.openBrowser) {
        const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
        exec(cmd, () => {
          // Best effort browser open
        });
      }

      resolvePromise({
        server,
        port: actualPort,
        url,
        watcher,
        stop: async () => {
          watcher.stop();
          return new Promise<void>((res) => {
            server.close(() => res());
          });
        },
      });
    });
  });
}
