# Cavalry MCP

A local, domain-specific MCP server for controlling [Cavalry](https://cavalry.studio/) through its installed JavaScript API. It exposes validated tools and structured JSON results instead of arbitrary script execution.

## Requirements

- Cavalry 2.4 or newer
- Node.js 20 or newer
- An MCP client with `stdio` support

## Install from this repository

```powershell
npm install
node src/index.js --install-bridge
```

Open Cavalry, choose **Scripts > Stallion**, and approve Cavalry's one-time trust prompt. The bundled [Stallion](https://github.com/scenery-io/stallion) bridge listens only on `127.0.0.1:8080`.

Configure the MCP client:

```json
{
  "mcpServers": {
    "cavalry": {
      "command": "node",
      "args": ["C:/absolute/path/to/cavalry-mcp/src/index.js"]
    }
  }
}
```

After publication to npm:

```powershell
npx -y cavalry-mcp install
```

If `Stallion.js` already exists and should be replaced, add `--force`. The legacy
`--install-bridge` flag remains supported.

```json
{
  "mcpServers": {
    "cavalry": {
      "command": "npx",
      "args": ["-y", "cavalry-mcp"]
    }
  }
}
```

## MCP interface

Every successful tool response includes both human-readable text and validated `structuredContent`.

| Tool | Purpose |
| --- | --- |
| `cavalry_status` | Check the local bridge. |
| `cavalry_scene_inspect` | Read the active scene, compositions, layers, selection, frame, path, and unsaved state. |
| `cavalry_layer_get` | Read a layer, its attributes, and optional attribute definitions. |
| `cavalry_layer_create` | Create, initialize, and parent a layer. |
| `cavalry_layer_update` | Rename, edit, parent, or unparent a layer. |
| `cavalry_layer_delete` | Validate and delete layers. |
| `cavalry_connection` | Connect or disconnect layer attributes. |
| `cavalry_keyframes_set` | Add or replace attribute keyframes. |
| `cavalry_keyframes_delete` | Delete selected frames or an entire animation. |
| `cavalry_expression_apply` | Apply JavaScript, SkSL, or render expressions with changed/skipped IDs. |
| `cavalry_scene_save` | Save safely to the current path or an explicit `.cv` path. |
| `cavalry_render_frame` | Render and verify a PNG while restoring the playhead. |
| `cavalry_api_search` | Search exact signatures from the installed Cavalry build. |
| `cavalry_api_call` | Call any installed `api` function directly with JSON arguments. |

The read-only `cavalry://scene` resource exposes the live scene summary to MCP clients that support resources.

### Dedicated tools first

Use the dedicated domain tools for normal work. `cavalry_api_call` is the fallback for the rest of Cavalry's installed `@JS_GUI_API` surface:

```json
{
  "method": "getFrame",
  "args": []
}
```

The server rejects unknown methods. Scene replacement and destructive scene operations require `confirmDangerous: true`. Arbitrary script execution, process execution, browser launches, and general filesystem read/write methods are never exposed by this fallback.

## Architecture

```text
MCP client ──stdio──> Cavalry MCP ──HTTP loopback──> Stallion ──> Cavalry api
                         │
                         └── installed API metadata for validation/discovery
```

The bridge executes temporary generated adapters, writes structured results, and removes temporary files after every call. No MCP network listener or arbitrary-JavaScript tool is exposed.

## Configuration

| Variable | Default |
| --- | --- |
| `CAVALRY_BRIDGE_URL` | `http://127.0.0.1:8080` (loopback hosts only) |
| `CAVALRY_METADATA_DIR` | Auto-detected Cavalry `assets/MetaData` directory |
| `CAVALRY_SCRIPTS_DIR` | Auto-detected user Scripts directory |

## Safety

Tool schemas validate input at the MCP boundary. Mutating tools declare MCP safety annotations, saves and renders refuse existing targets unless explicitly allowed, render restores the previous frame, and generic API calls are restricted to installed metadata.

An MCP client still has substantial authority over the open Cavalry scene. Keep Stallion on loopback and save important work before approving mutations.

## Development

```powershell
npm run check
npm test
npm run smoke
npm run smoke:mcp
npm run smoke:write # creates and removes a temporary layer and PNG
npm pack --dry-run
```

MIT licensed. Stallion remains copyright its original author and is included under its MIT license in `THIRD_PARTY_LICENSES.md`.
