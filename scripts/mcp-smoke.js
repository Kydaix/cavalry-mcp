import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "src", "index.js")],
  cwd: root,
  stderr: "inherit"
});
const client = new Client({ name: "cavalry-mcp-smoke", version: "0.2.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
    "cavalry_api_call",
    "cavalry_api_search",
    "cavalry_connection",
    "cavalry_expression_apply",
    "cavalry_keyframes_delete",
    "cavalry_keyframes_set",
    "cavalry_layer_create",
    "cavalry_layer_delete",
    "cavalry_layer_get",
    "cavalry_layer_update",
    "cavalry_render_frame",
    "cavalry_scene_inspect",
    "cavalry_scene_save",
    "cavalry_status"
  ]);

  const status = await client.callTool({ name: "cavalry_status", arguments: {} });
  assert.equal(status.isError, undefined);
  assert.equal(JSON.parse(status.content[0].text).connected, true);

  const apiSearch = await client.callTool({
    name: "cavalry_api_search",
    arguments: { query: "saveSceneAs", limit: 5 }
  });
  assert.equal(apiSearch.isError, undefined);
  assert.ok(apiSearch.structuredContent.matches.some(entry => entry.name === "saveSceneAs"));

  const scene = await client.callTool({ name: "cavalry_scene_inspect", arguments: {} });
  assert.equal(scene.isError, undefined);

  const layer = await client.callTool({
    name: "cavalry_layer_get",
    arguments: { layerId: scene.structuredContent.activeComposition.id, attributeIds: ["resolution"] }
  });
  assert.equal(layer.isError, undefined);

  const directCall = await client.callTool({
    name: "cavalry_api_call",
    arguments: { method: "getFrame", args: [] }
  });
  assert.equal(directCall.isError, undefined);
  assert.equal(directCall.structuredContent.result, scene.structuredContent.frame);

  const blockedDangerousCall = await client.callTool({
    name: "cavalry_api_call",
    arguments: { method: "deleteLayer", args: ["does-not-exist"] }
  });
  assert.equal(blockedDangerousCall.isError, true);
  assert.match(blockedDangerousCall.content[0].text, /confirmDangerous=true/);

  const blockedScriptCall = await client.callTool({
    name: "cavalry_api_call",
    arguments: { method: "exec", args: ["test", "1 + 1"] }
  });
  assert.equal(blockedScriptCall.isError, true);
  assert.match(blockedScriptCall.content[0].text, /not exposed/);

  const resources = await client.listResources();
  assert.ok(resources.resources.some(resource => resource.uri === "cavalry://scene"));
  const resource = await client.readResource({ uri: "cavalry://scene" });
  assert.equal(JSON.parse(resource.contents[0].text).frame, scene.structuredContent.frame);
  console.log(JSON.stringify({ tools: listed.tools.length, scene: scene.structuredContent }, null, 2));
} finally {
  await client.close();
}
