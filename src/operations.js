import { stat } from "node:fs/promises";
import {
  EXPRESSION_TYPES,
  executeOperation,
  findApiFunction,
  searchApiMetadata
} from "./cavalry.js";

const js = value => JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
const pathForCavalry = value => value.replaceAll("\\", "/");
const layerDescription = `
function describeLayer(id) {
  var parentId = null;
  try { parentId = api.getParent(id) || null; } catch (error) {}
  return { id: id, name: api.getNiceName(id), type: api.getLayerType(id), parentId: parentId };
}`;

export async function inspectScene() {
  return executeOperation(`${layerDescription}
var activeCompositionId = api.getActiveComp();
return {
  filePath: api.getSceneFilePath(),
  hasUnsavedChanges: api.sceneHasUnsavedChanges(),
  frame: api.getFrame(),
  activeComposition: describeLayer(activeCompositionId),
  selection: api.getSelection(true),
  compositions: api.getComps().map(describeLayer),
  layers: api.getAllSceneLayers().map(describeLayer)
};`);
}

export async function getLayer({ layerId, attributeIds, includeDefinitions = false }) {
  return executeOperation(`${layerDescription}
var input = ${js({ layerId, attributeIds, includeDefinitions })};
var ids = input.attributeIds && input.attributeIds.length ? input.attributeIds : api.getAttributes(input.layerId);
var attributes = ids.map(function (attributeId) {
  var item = { id: attributeId };
  try { item.value = api.get(input.layerId, attributeId); } catch (error) { item.error = String(error); }
  if (input.includeDefinitions) {
    try { item.definition = api.getAttributeDefinition(input.layerId, attributeId); } catch (error) { item.definitionError = String(error); }
  }
  return item;
});
return Object.assign(describeLayer(input.layerId), { attributes: attributes });`);
}

export async function createLayer({ type, name, attributes, parentId, allowDefaultPreset = true }) {
  return executeOperation(`${layerDescription}
var input = ${js({ type, name, attributes, parentId, allowDefaultPreset })};
var id = typeof input.name === "string" ? api.create(input.type, input.name, input.allowDefaultPreset) : api.create(input.type);
if (input.attributes && Object.keys(input.attributes).length) api.set(id, input.attributes);
if (input.parentId) api.parent(id, input.parentId);
return describeLayer(id);`);
}

export async function updateLayer({ layerId, name, attributes, parentId }) {
  if (name === undefined && attributes === undefined && parentId === undefined) {
    throw new Error("Provide name, attributes, or parentId.");
  }
  return executeOperation(`${layerDescription}
var input = ${js({ layerId, name, attributes, parentId })};
if (typeof input.name !== "undefined") api.rename(input.layerId, input.name);
if (input.attributes && Object.keys(input.attributes).length) api.set(input.layerId, input.attributes);
if (typeof input.parentId !== "undefined") {
  if (input.parentId === null) api.unParent(input.layerId);
  else api.parent(input.layerId, input.parentId);
}
return describeLayer(input.layerId);`);
}

export async function deleteLayers(layerIds) {
  return executeOperation(`
var layerIds = ${js(layerIds)};
layerIds.forEach(function (id) {
  if (!api.getLayerType(id)) throw new Error("Layer not found: " + id);
});
layerIds.forEach(function (id) { api.deleteLayer(id); });
return { deleted: layerIds };`);
}

export async function updateConnection({ action, fromLayerId, fromAttributeId, toLayerId, toAttributeId, force = false }) {
  return executeOperation(`
var input = ${js({ action, fromLayerId, fromAttributeId, toLayerId, toAttributeId, force })};
if (input.action === "connect") api.connect(input.fromLayerId, input.fromAttributeId, input.toLayerId, input.toAttributeId, input.force);
else api.disconnect(input.fromLayerId, input.fromAttributeId, input.toLayerId, input.toAttributeId);
return input;`);
}

export async function setKeyframes({ layerId, keyframes }) {
  if (keyframes.some(keyframe => !Object.keys(keyframe.values).length)) {
    throw new Error("Each keyframe must contain at least one attribute value.");
  }
  return executeOperation(`
var input = ${js({ layerId, keyframes })};
var created = input.keyframes.map(function (keyframe) {
  return { frame: keyframe.frame, id: api.keyframe(input.layerId, keyframe.frame, keyframe.values) };
});
return { layerId: input.layerId, created: created };`);
}

export async function deleteKeyframes({ layerId, attributeId, mode, frames = [] }) {
  if (mode === "frames" && !frames.length) throw new Error("frames is required when mode is 'frames'.");
  return executeOperation(`
var input = ${js({ layerId, attributeId, mode, frames })};
if (input.mode === "animation") api.deleteAnimation(input.layerId, input.attributeId);
else input.frames.forEach(function (frame) { api.deleteKeyframe(input.layerId, input.attributeId, frame); });
return { layerId: input.layerId, attributeId: input.attributeId, mode: input.mode, deletedFrames: input.frames };`);
}

export async function applyExpression({ type, code }) {
  if (!EXPRESSION_TYPES.includes(type)) throw new Error(`Unsupported expression type: ${type}`);
  return executeOperation(`
var input = ${js({ type, code })};
var applied = [];
var skipped = [];
if (input.type.indexOf("render") !== -1 || input.type.indexOf("Render") !== -1) {
  api.getRenderQueueItems().forEach(function (id) {
    if (api.get(id, "selected")) { api.set(id, { [input.type]: input.code }); applied.push(id); }
  });
} else {
  var ids = api.getSelection();
  if (!ids.length) ids = [api.create(input.type)];
  var attributeId = input.type === "javaScriptShape" ? "generator.expression" : (input.type.indexOf("sksl") === 0 ? "code" : "expression");
  ids.forEach(function (id) {
    if (api.getLayerType(id) !== input.type) skipped.push(id);
    else { api.set(id, { [attributeId]: input.code }); applied.push(id); }
  });
}
return { type: input.type, applied: applied, skipped: skipped };`);
}

export async function saveScene({ path, overwrite = false, timeoutMs = 60000 } = {}) {
  const normalizedPath = path ? pathForCavalry(path) : undefined;
  return executeOperation(`
var input = ${js({ path: normalizedPath, overwrite })};
var currentPath = api.getSceneFilePath();
var saved;
if (input.path) {
  if (!input.overwrite && api.filePathExists(input.path) && input.path !== currentPath) throw new Error("Target scene already exists.");
  saved = api.saveSceneAs(input.path);
} else {
  if (!currentPath) throw new Error("The scene has no path. Provide path.");
  saved = api.saveScene();
}
if (!saved) throw new Error("Cavalry did not save the scene.");
return { saved: true, path: api.getSceneFilePath() };`, { timeoutMs });
}

export async function renderFrame({ path, frame, scalePercent = 100, overwrite = false, timeoutMs = 60000 }) {
  const normalizedPath = pathForCavalry(path);
  const result = await executeOperation(`
var input = ${js({ path: normalizedPath, frame, scalePercent, overwrite })};
if (!input.overwrite && api.filePathExists(input.path)) throw new Error("Target image already exists.");
var previousFrame = api.getFrame();
var renderedFrame = typeof input.frame === "number" ? input.frame : previousFrame;
try {
  if (typeof input.frame === "number") api.setFrame(input.frame);
  api.renderPNGFrame(input.path, input.scalePercent);
} finally {
  if (typeof input.frame === "number") api.setFrame(previousFrame);
}
return { path: input.path, frame: renderedFrame, scalePercent: input.scalePercent };`, { timeoutMs });
  const file = await stat(path);
  return { ...result, bytes: file.size };
}

const dangerousApiMethods = new Set([
  "deleteAnimation",
  "deleteKeyframe",
  "deleteLayer",
  "exportSceneAs",
  "newScene",
  "openScene",
  "renderPNGFrame",
  "saveScene",
  "saveSceneAs"
]);
const blockedApiMethods = new Set([
  "copyFilePath",
  "deleteFilePath",
  "encodeBinary",
  "exec",
  "listDirectory",
  "listDirectoryPaths",
  "listDirectoryRecursive",
  "load",
  "openURL",
  "readFromFile",
  "runDetachedProcess",
  "runProcess",
  "unzip",
  "writeEncodedToBinaryFile",
  "writeToFile"
]);

export async function callApi({ method, args = [], confirmDangerous = false }) {
  const metadata = await findApiFunction(method);
  if (!metadata) throw new Error(`Unknown Cavalry api function: ${method}`);
  if (blockedApiMethods.has(method)) throw new Error(`${method} is not exposed by cavalry_api_call.`);
  if (dangerousApiMethods.has(method) && !confirmDangerous) {
    throw new Error(`${method} requires confirmDangerous=true.`);
  }
  const result = await executeOperation(`
var method = ${js(metadata.name)};
var args = ${js(args)};
if (typeof api[method] !== "function") throw new Error("Cavalry api function is unavailable: " + method);
return api[method].apply(api, args);`);
  return { method: metadata.name, result };
}

export async function searchApi(query, limit) {
  return { matches: await searchApiMetadata(query, { limit }) };
}
