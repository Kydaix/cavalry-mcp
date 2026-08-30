import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const imagePath = join(tmpdir(), `cavalry-mcp-write-smoke-${process.pid}.png`);
const lottiePath = join(tmpdir(), `cavalry-mcp-write-smoke-${process.pid}.json`);
const client = new Client({ name: "cavalry-mcp-write-smoke", version: "0.2.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "src", "index.js")],
  cwd: root,
  stderr: "inherit"
});
const createdIds = [];
let originalSelection = [];
let connected = false;

try {
  await client.connect(transport);
  connected = true;
  const scene = await client.callTool({ name: "cavalry_scene_inspect", arguments: {} });
  originalSelection = scene.structuredContent.selection;
  const created = await client.callTool({
    name: "cavalry_layer_create",
    arguments: { type: "textShape", name: "Cavalry MCP Write Smoke" }
  });
  assert.equal(created.isError, undefined);
  const layerId = created.structuredContent.id;
  createdIds.push(layerId);

  const updated = await client.callTool({
    name: "cavalry_layer_update",
    arguments: { layerId, name: "Cavalry MCP Write Smoke Updated" }
  });
  assert.equal(updated.structuredContent.name, "Cavalry MCP Write Smoke Updated");

  const read = await client.callTool({
    name: "cavalry_layer_get",
    arguments: { layerId, attributeIds: ["text"] }
  });
  assert.equal(read.structuredContent.id, layerId);
  assert.equal(read.structuredContent.attributes[0].error, undefined);

  const keyframes = await client.callTool({
    name: "cavalry_keyframes_set",
    arguments: { layerId, keyframes: [{ frame: 0, values: { text: read.structuredContent.attributes[0].value } }] }
  });
  assert.equal(keyframes.isError, undefined);
  assert.equal(keyframes.structuredContent.created[0].frame, 0);

  const deletedKeyframes = await client.callTool({
    name: "cavalry_keyframes_delete",
    arguments: { layerId, attributeId: "text", mode: "animation", frames: [] }
  });
  assert.equal(deletedKeyframes.isError, undefined);

  const star = await client.callTool({ name: "cavalry_api_call", arguments: { method: "primitive", args: ["star", "MCP Smoke Star"] } });
  const ellipse = await client.callTool({ name: "cavalry_api_call", arguments: { method: "primitive", args: ["ellipse", "MCP Smoke Ellipse"] } });
  const pathfinder = await client.callTool({ name: "cavalry_layer_create", arguments: { type: "pathfinder", name: "MCP Smoke Pathfinder" } });
  createdIds.push(star.structuredContent.result, ellipse.structuredContent.result, pathfinder.structuredContent.id);

  const firstConnection = {
    action: "connect",
    fromLayerId: star.structuredContent.result,
    fromAttributeId: "id",
    toLayerId: pathfinder.structuredContent.id,
    toAttributeId: "inputShape",
    force: false
  };
  const secondConnection = {
    action: "connect",
    fromLayerId: pathfinder.structuredContent.id,
    fromAttributeId: "id",
    toLayerId: ellipse.structuredContent.result,
    toAttributeId: "position",
    force: false
  };
  assert.equal((await client.callTool({ name: "cavalry_connection", arguments: firstConnection })).isError, undefined);
  assert.equal((await client.callTool({ name: "cavalry_connection", arguments: secondConnection })).isError, undefined);
  assert.equal((await client.callTool({ name: "cavalry_connection", arguments: { ...secondConnection, action: "disconnect" } })).isError, undefined);
  assert.equal((await client.callTool({ name: "cavalry_connection", arguments: { ...firstConnection, action: "disconnect" } })).isError, undefined);

  await client.callTool({ name: "cavalry_api_call", arguments: { method: "select", args: [[]] } });
  const expression = await client.callTool({
    name: "cavalry_expression_apply",
    arguments: { type: "javaScript", code: "1;" }
  });
  assert.equal(expression.isError, undefined);
  createdIds.push(...expression.structuredContent.applied);

  const rendered = await client.callTool({
    name: "cavalry_render_frame",
    arguments: { path: imagePath, scalePercent: 10, overwrite: true }
  });
  assert.ok(rendered.structuredContent.bytes > 0);
  const lottie = await client.callTool({
    name: "cavalry_render_lottie",
    arguments: { path: lottiePath, overwrite: true }
  });
  assert.equal(lottie.isError, undefined);
  assert.ok(lottie.structuredContent.bytes > 0);
  createdIds.push(lottie.structuredContent.renderQueueItemId);
  console.log(JSON.stringify({ created: createdIds.length, keyframes: keyframes.structuredContent.created.length, connections: 2, expressions: expression.structuredContent.applied.length, renderedBytes: rendered.structuredContent.bytes, lottieBytes: lottie.structuredContent.bytes }, null, 2));
} finally {
  if (connected && createdIds.length) {
    const deleted = await client.callTool({ name: "cavalry_layer_delete", arguments: { layerIds: createdIds } });
    assert.equal(deleted.isError, undefined);
  }
  if (connected) await client.callTool({ name: "cavalry_api_call", arguments: { method: "select", args: [originalSelection] } });
  await client.close();
  await rm(imagePath, { force: true });
  await rm(lottiePath, { force: true });
}
