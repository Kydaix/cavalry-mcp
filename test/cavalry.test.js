import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertLocalBridgeUrl, buildWrappedScript, findApiFunction, installBridge, searchApiMetadata } from "../src/cavalry.js";

const execFileAsync = promisify(execFile);

test("the bridge is restricted to the local machine", () => {
  assert.equal(assertLocalBridgeUrl("http://localhost:8080/"), "http://localhost:8080");
  assert.equal(assertLocalBridgeUrl("http://[::1]:8080"), "http://[::1]:8080");
  assert.throws(() => assertLocalBridgeUrl("https://example.com"), /loopback/);
  assert.throws(() => assertLocalBridgeUrl("file://localhost/tmp"), /loopback/);
});

test("the bundled Stallion bridge installs without overwriting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cavalry-mcp-bridge-test-"));
  try {
    const target = await installBridge({ scriptsDirectory: directory });
    assert.match(await readFile(target, "utf8"), /^\/\/ VERSION 0\.7\.0/);
    await assert.rejects(() => installBridge({ scriptsDirectory: directory }), /already exists/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the CLI exposes an npx-compatible install subcommand", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cavalry-mcp-cli-test-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(new URL("../src/index.js", import.meta.url)), "install"], {
      env: { ...process.env, CAVALRY_SCRIPTS_DIR: directory }
    });
    assert.match(stdout, /Installed Stallion/);
    assert.match(await readFile(join(directory, "Stallion.js"), "utf8"), /^\/\/ VERSION 0\.7\.0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Cavalry scripts return results through a temporary JSON file", () => {
  const script = buildWrappedScript("return { frame: api.getFrame() };", "C:\\Temp\\result.json");
  assert.match(script, /api\.getFrame\(\)/);
  assert.match(script, /C:\/Temp\/result\.json/);
  assert.match(script, /api\.writeToFile/);
});

test("installed API metadata is searched literally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cavalry-mcp-test-"));
  try {
    await writeFile(join(directory, "api_function_metadata.json"), JSON.stringify([
      { namespace: "@JS_GUI_API", name: "saveSceneAs", description: "Saves a Scene." },
      { namespace: "@JS_GUI_API", name: "renderPNGFrame", description: "Renders a frame." }
    ]));
    const matches = await searchApiMetadata("save", { metadataDirectory: directory });
    assert.deepEqual(matches.map(entry => entry.name), ["saveSceneAs"]);
    assert.equal((await findApiFunction("saveSceneAs", { metadataDirectory: directory })).name, "saveSceneAs");
    assert.equal(await findApiFunction("missing", { metadataDirectory: directory }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
