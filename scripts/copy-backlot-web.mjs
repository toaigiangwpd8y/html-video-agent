import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// Copy Backlot static files and local Markdown runtime packages into the build output.
const root = process.cwd();
const webSource = resolve(root, "src/backlot/web");
const webOutput = resolve(root, "dist/src/backlot/web");
const vendorOutput = resolve(webOutput, "vendor");
const explorerOutput = resolve(webOutput, "explorer-assets");

cpSync(webSource, webOutput, { recursive: true });
cpSync(resolve(root, "packages/app-explorer/public"), explorerOutput, { recursive: true });
rmSync(resolve(webOutput, "demo-data.js"), { force: true });
rmSync(resolve(webOutput, "demo-assets"), { recursive: true, force: true });
mkdirSync(vendorOutput, { recursive: true });
copyFileSync(resolve(root, "node_modules/marked/lib/marked.esm.js"), resolve(vendorOutput, "marked.js"));
copyFileSync(resolve(root, "node_modules/dompurify/dist/purify.es.mjs"), resolve(vendorOutput, "purify.js"));
copyFileSync(resolve(root, "node_modules/marked/LICENSE"), resolve(vendorOutput, "MARKED-LICENSE"));
copyFileSync(resolve(root, "node_modules/dompurify/LICENSE"), resolve(vendorOutput, "DOMPURIFY-APACHE-LICENSE"));
copyFileSync(resolve(root, "node_modules/dompurify/LICENSE-MPL"), resolve(vendorOutput, "DOMPURIFY-MPL-LICENSE"));
