#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { installBridge } from "./cavalry.js";
import { createServer } from "./server.js";

const args = process.argv.slice(2);
if (args[0] === "install" || args.includes("--install-bridge")) {
  try {
    const target = await installBridge({ force: args.includes("--force") });
    console.log(`Installed Stallion at ${target}`);
    console.log("Open Cavalry, choose Scripts > Stallion, and approve its one-time trust prompt.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  await createServer().connect(new StdioServerTransport());
}
