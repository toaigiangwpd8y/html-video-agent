import { startBacklotServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let port = 4200;
  let openBrowser = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--no-open") {
      openBrowser = false;
    } else if (args[i] === "--open") {
      openBrowser = true;
    }
  }

  const instance = await startBacklotServer({
    root: process.cwd(),
    port,
    openBrowser,
  });

  console.log(`Backlot Dashboard is running at ${instance.url}`);
  console.log("Observing video authoring workflow in real-time. Press Ctrl+C to exit.");

  const shutdown = async (): Promise<void> => {
    console.log("\nStopping Backlot Dashboard...");
    await instance.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start Backlot:", error);
  process.exit(1);
});
