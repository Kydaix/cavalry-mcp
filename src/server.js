import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { EXPRESSION_TYPES, getBridgeStatus } from "./cavalry.js";
import {
  applyExpression,
  callApi,
  createLayer,
  deleteKeyframes,
  deleteLayers,
  getLayer,
  inspectScene,
  renderFrame,
  saveScene,
  searchApi,
  setKeyframes,
  updateConnection,
  updateLayer
} from "./operations.js";

const id = z.string().min(1).max(500);
const absolutePath = extension => z.string().min(1).max(32768).regex(extension).refine(isAbsolute, "path must be absolute");
const attributes = z.record(z.string(), z.unknown());
const layerSummary = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  parentId: z.string().nullable()
});
const layerDetail = layerSummary.extend({ attributes: z.array(z.record(z.string(), z.unknown())) });
const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

const success = value => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value
});
const failure = error => ({
  content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  isError: true
});
const handle = operation => async input => {
  try {
    return success(await operation(input));
  } catch (error) {
    return failure(error);
  }
};

export function createServer() {
  const server = new McpServer({ name: "cavalry-mcp", version: "0.2.0" });

  server.registerTool("cavalry_status", {
    title: "Cavalry status",
    description: "Check whether the local Cavalry Stallion bridge is reachable.",
    outputSchema: {
      connected: z.boolean(),
      url: z.string(),
      status: z.number().optional(),
      error: z.string().optional()
    },
    annotations: readOnly
  }, handle(() => getBridgeStatus()));

  server.registerTool("cavalry_scene_inspect", {
    title: "Inspect Cavalry scene",
    description: "Return the active composition, frame, selection, compositions, layers, file path, and unsaved state.",
    outputSchema: {
      filePath: z.string(),
      hasUnsavedChanges: z.boolean(),
      frame: z.number().int(),
      activeComposition: layerSummary,
      selection: z.array(z.string()),
      compositions: z.array(layerSummary),
      layers: z.array(layerSummary)
    },
    annotations: readOnly
  }, handle(() => inspectScene()));

  server.registerTool("cavalry_layer_get", {
    title: "Get Cavalry layer",
    description: "Read a layer and its attribute values. Omit attributeIds to read every available attribute.",
    inputSchema: {
      layerId: id,
      attributeIds: z.array(id).max(500).optional(),
      includeDefinitions: z.boolean().default(false)
    },
    outputSchema: layerDetail,
    annotations: readOnly
  }, handle(getLayer));

  server.registerTool("cavalry_layer_create", {
    title: "Create Cavalry layer",
    description: "Create a layer, optionally set initial attributes and parent it, then return its resolved identity.",
    inputSchema: {
      type: z.string().min(1).max(200),
      name: z.string().min(1).max(500).optional(),
      attributes: attributes.optional(),
      parentId: id.optional(),
      allowDefaultPreset: z.boolean().default(true)
    },
    outputSchema: layerSummary,
    annotations: additive
  }, handle(createLayer));

  server.registerTool("cavalry_layer_update", {
    title: "Update Cavalry layer",
    description: "Rename a layer, set attributes, and/or change its parent. Set parentId to null to unparent it.",
    inputSchema: {
      layerId: id,
      name: z.string().min(1).max(500).optional(),
      attributes: attributes.optional(),
      parentId: id.nullable().optional()
    },
    outputSchema: layerSummary,
    annotations: destructive
  }, handle(updateLayer));

  server.registerTool("cavalry_layer_delete", {
    title: "Delete Cavalry layers",
    description: "Delete one or more layers after validating that every supplied layer exists.",
    inputSchema: { layerIds: z.array(id).min(1).max(100) },
    outputSchema: { deleted: z.array(z.string()) },
    annotations: destructive
  }, handle(({ layerIds }) => deleteLayers(layerIds)));

  server.registerTool("cavalry_connection", {
    title: "Update Cavalry connection",
    description: "Connect or disconnect two Cavalry layer attributes. force may replace an existing destination connection.",
    inputSchema: {
      action: z.enum(["connect", "disconnect"]),
      fromLayerId: id,
      fromAttributeId: id,
      toLayerId: id,
      toAttributeId: id,
      force: z.boolean().default(false)
    },
    outputSchema: {
      action: z.enum(["connect", "disconnect"]),
      fromLayerId: z.string(),
      fromAttributeId: z.string(),
      toLayerId: z.string(),
      toAttributeId: z.string(),
      force: z.boolean()
    },
    annotations: destructive
  }, handle(updateConnection));

  server.registerTool("cavalry_keyframes_set", {
    title: "Set Cavalry keyframes",
    description: "Set one or more keyframes on a layer; each frame accepts an attribute-value dictionary.",
    inputSchema: {
      layerId: id,
      keyframes: z.array(z.object({ frame: z.number().int(), values: attributes })).min(1).max(1000)
    },
    outputSchema: {
      layerId: z.string(),
      created: z.array(z.object({ frame: z.number().int(), id: z.string() }))
    },
    annotations: destructive
  }, handle(setKeyframes));

  server.registerTool("cavalry_keyframes_delete", {
    title: "Delete Cavalry keyframes",
    description: "Delete specific frames or all animation from one layer attribute.",
    inputSchema: {
      layerId: id,
      attributeId: id,
      mode: z.enum(["frames", "animation"]),
      frames: z.array(z.number().int()).max(1000).default([])
    },
    outputSchema: {
      layerId: z.string(),
      attributeId: z.string(),
      mode: z.enum(["frames", "animation"]),
      deletedFrames: z.array(z.number().int())
    },
    annotations: destructive
  }, handle(deleteKeyframes));

  server.registerTool("cavalry_expression_apply", {
    title: "Apply Cavalry expression",
    description: "Apply a JavaScript, SkSL, or render expression and report exactly which layers or render items were changed or skipped.",
    inputSchema: {
      type: z.enum(EXPRESSION_TYPES),
      code: z.string().min(1).max(500000)
    },
    outputSchema: {
      type: z.string(),
      applied: z.array(z.string()),
      skipped: z.array(z.string())
    },
    annotations: destructive
  }, handle(applyExpression));

  server.registerTool("cavalry_scene_save", {
    title: "Save Cavalry scene",
    description: "Save the current scene, or save it to an explicit .cv path. Existing targets require overwrite=true.",
    inputSchema: {
      path: absolutePath(/\.cv$/i).optional(),
      overwrite: z.boolean().default(false),
      timeoutMs: z.number().int().min(1000).max(600000).default(60000)
    },
    outputSchema: { saved: z.boolean(), path: z.string() },
    annotations: destructive
  }, handle(saveScene));

  server.registerTool("cavalry_render_frame", {
    title: "Render Cavalry PNG frame",
    description: "Render a PNG at an optional frame, restore the previous playhead, and verify the output file.",
    inputSchema: {
      path: absolutePath(/\.png$/i),
      frame: z.number().int().optional(),
      scalePercent: z.number().min(1).max(1000).default(100),
      overwrite: z.boolean().default(false),
      timeoutMs: z.number().int().min(1000).max(600000).default(60000)
    },
    outputSchema: {
      path: z.string(),
      frame: z.number().int(),
      scalePercent: z.number(),
      bytes: z.number().int().nonnegative()
    },
    annotations: destructive
  }, handle(renderFrame));

  server.registerTool("cavalry_api_search", {
    title: "Search installed Cavalry API",
    description: "Search exact signatures and descriptions from the installed Cavalry API metadata.",
    inputSchema: {
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(100).default(30)
    },
    outputSchema: { matches: z.array(z.record(z.string(), z.unknown())) },
    annotations: readOnly
  }, handle(({ query, limit }) => searchApi(query, limit)));

  server.registerTool("cavalry_api_call", {
    title: "Call installed Cavalry API function",
    description: "Call one exact api function found in the installed @JS_GUI_API metadata. This is the typed escape hatch for functionality without a dedicated tool; it does not execute arbitrary JavaScript.",
    inputSchema: {
      method: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(200),
      args: z.array(z.unknown()).max(50).default([]),
      confirmDangerous: z.boolean().default(false)
    },
    outputSchema: { method: z.string(), result: z.unknown() },
    annotations: destructive
  }, handle(callApi));

  server.registerResource("current-cavalry-scene", "cavalry://scene", {
    title: "Current Cavalry scene",
    description: "Live read-only summary of the scene currently open in Cavalry.",
    mimeType: "application/json"
  }, async uri => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await inspectScene(), null, 2) }]
  }));

  return server;
}
