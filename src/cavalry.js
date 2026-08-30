import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8080";
export const EXPRESSION_TYPES = [
  "javaScriptShape",
  "javaScript",
  "javaScriptModifier",
  "javaScriptDeformer",
  "javaScriptEmitter",
  "skslShader",
  "skslFilter",
  "renderSetupExpression",
  "preRenderExpression",
  "postRenderExpression"
];

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function assertLocalBridgeUrl(value = process.env.CAVALRY_BRIDGE_URL || DEFAULT_BRIDGE_URL) {
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("CAVALRY_BRIDGE_URL must use a loopback host.");
  }
  return url.href.replace(/\/$/, "");
}

async function postToBridge(payload, bridgeUrl) {
  const response = await fetch(`${assertLocalBridgeUrl(bridgeUrl)}/post`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Cavalry bridge returned HTTP ${response.status}.`);
}

export async function getBridgeStatus(bridgeUrl) {
  const url = assertLocalBridgeUrl(bridgeUrl);
  try {
    const response = await fetch(`${url}/get`, { signal: AbortSignal.timeout(2000) });
    return { connected: response.ok, url, status: response.status };
  } catch (error) {
    return { connected: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildWrappedScript(code, resultPath) {
  const target = resultPath.replaceAll("\\", "/");
  return `(function () {
  var __cavalryMcpResultPath = ${JSON.stringify(target)};
  function __cavalryMcpWrite(value) {
    var payload;
    try {
      payload = JSON.stringify(value);
    } catch (error) {
      payload = JSON.stringify({ ok: false, error: "Result is not JSON-serializable: " + String(error) });
    }
    api.writeToFile(__cavalryMcpResultPath, payload, true);
  }
  try {
    var result = (function () {
${code.split("\n").map(line => `      ${line}`).join("\n")}
    })();
    __cavalryMcpWrite({ ok: true, result: typeof result === "undefined" ? null : result });
  } catch (error) {
    __cavalryMcpWrite({
      ok: false,
      error: String(error),
      stack: error && error.stack ? String(error.stack) : ""
    });
  }
})();
`;
}

async function waitForResult(resultPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(resultPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await delay(50);
    }
  }
  throw new Error(`Cavalry did not return a result within ${timeoutMs}ms. Check its JavaScript Console.`);
}

export async function executeScript(code, { bridgeUrl, timeoutMs = 10000 } = {}) {
  if (!code.trim()) throw new Error("code must not be empty.");
  const taskDirectory = await mkdtemp(join(tmpdir(), "cavalry-mcp-"));
  const scriptPath = join(taskDirectory, "task.js");
  const resultPath = join(taskDirectory, "result.json");
  await writeFile(scriptPath, buildWrappedScript(code, resultPath), "utf8");

  try {
    await postToBridge({ type: "script", code: "", path: scriptPath }, bridgeUrl);
    return await waitForResult(resultPath, timeoutMs);
  } finally {
    await rm(taskDirectory, { recursive: true, force: true });
  }
}

export async function executeOperation(code, options) {
  const response = await executeScript(code, options);
  if (!response.ok) throw new Error(response.error || "Cavalry operation failed.");
  return response.result;
}

async function firstExisting(paths) {
  for (const path of paths.filter(Boolean)) {
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

export async function findMetadataDirectory(override = process.env.CAVALRY_METADATA_DIR) {
  const candidates = [override];
  if (platform() === "win32") {
    candidates.push(join(process.env.ProgramFiles || "C:\\Program Files", "Cavalry", "assets", "MetaData"));
  } else if (platform() === "darwin") {
    candidates.push("/Applications/Cavalry.app/Contents/Resources/assets/MetaData");
  }
  const found = await firstExisting(candidates);
  if (!found) throw new Error("Cavalry API metadata was not found. Set CAVALRY_METADATA_DIR.");
  return found;
}

export async function searchApiMetadata(query, { limit = 30, metadataDirectory, namespace } = {}) {
  if (!query.trim()) throw new Error("query must not be empty.");
  const directory = metadataDirectory || await findMetadataDirectory();
  const needle = query.toLowerCase();
  const files = (await readdir(directory)).filter(name => name.endsWith("api_function_metadata.json"));
  const matches = [];

  for (const file of files) {
    const entries = JSON.parse(await readFile(join(directory, file), "utf8"));
    for (const entry of entries) {
      const searchable = [entry.name, entry.namespace, entry.description].filter(Boolean).join(" ").toLowerCase();
      if ((!namespace || entry.namespace === namespace) && searchable.includes(needle)) matches.push({ file, ...entry });
    }
  }

  return matches.sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, limit);
}

export async function findApiFunction(name, options = {}) {
  const matches = await searchApiMetadata(name, { ...options, limit: 100, namespace: "@JS_GUI_API" });
  return matches.find(entry => entry.name === name) || null;
}

export function getScriptsDirectory(override = process.env.CAVALRY_SCRIPTS_DIR) {
  if (override) return override;
  if (platform() === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Cavalry", "Scripts");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Cavalry", "Scripts");
  return join(homedir(), ".config", "Cavalry", "Scripts");
}

export async function installBridge({ force = false, scriptsDirectory } = {}) {
  const source = fileURLToPath(new URL("../vendor/Stallion.js", import.meta.url));
  const target = join(scriptsDirectory || getScriptsDirectory(), "Stallion.js");
  if (!force && await firstExisting([target])) {
    throw new Error(`${target} already exists. Use --force to replace it.`);
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return target;
}
