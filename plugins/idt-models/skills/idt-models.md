# IDT intranet models

Generation models run on the IDT intranet GPU servers and this plugin reaches them directly. None of
them is a chat model, so they are tools this session calls — never a model this session runs on.

| Tool | Model | Input → output | Cost |
| --- | --- | --- | --- |
| `idt-models__model3d` | Hunyuan3D-2.1 | one picture → textured 3D with PBR maps (GLB, plus OBJ and the texture maps) | a shared GPU, ~1 minute |
| `idt-models__model3d` | Hunyuan3D-2.1 | words → 3D, or four views → 3D | a shared GPU, about as long |
| `idt-models__model3d` | TRELLIS.2-4B | one picture → 3D with PBR materials (GLB, up to 1536³) | a shared GPU, ~2 minutes |
| `idt-models__image` | FLUX.2-klein-4B | words → picture | ~10 seconds |
| `idt-models__image` | Qwen-Image-Edit | picture + instruction → four views of the edited picture | ~10 seconds |
| `idt-models__segment` | GroundingDINO + SAM2 | picture → one picture per object | a shared GPU, needs a token |
| `idt-models__status` | — | reads what the servers have loaded, and whether the route reaches a model | free |

The picture service chooses between FLUX and Qwen-Image-Edit itself: a prompt alone is text to image,
a prompt with a picture is an edit. There is nothing to pick. The 3D service takes a picture unless
you give it a prompt (text to 3D) or four views (multiview to 3D), or name `trellis2-4b` for TRELLIS.

## When to use a generation tool

Reach for one when the game needs something primitives cannot sell: a character or prop that wants
real silhouette and texture, an organic shape, painted art, a texture map, a decal, UI art. Stay with
`blender__model` when the shape is hard-surface, geometric or needs exact metres — a box, a wall kit,
a bench — because a bpy script gives a deterministic mesh and a GLB that is already game-ready.

Generate once and keep the file. Do not call a generation tool in a loop to "try variations" without
a reason you can state; each call takes a shared GPU away from everyone else.

## What a call does

1. The picture you name is read from this game (a relative path, for example `assets/concept.png`) and
   sent to the intranet server only. Nothing leaves the intranet.
2. The server generates; this plugin writes the result into its own storage and hands it to Studio
   with `assets.deliver`.
3. The files land in this game under `assets/idt-models/<job-id>/` and appear on the Assets tab. The
   returned `files` are project-relative paths — use exactly those. A GLB opens in the 3D viewer.

An edit returns **four** files, one per view (`…-front.png`, `…-left.png`, `…-top.png`,
`…-perspective.png`). Use the one the game needs; do not assume `front` is the only one.

## Working order

- `idt-models__status` first if anything looks wrong: it says which models are loaded, whether the
  shared route actually reaches a model (`flexibleRoute.reachesLauncher`), and whether the
  segmentation service is waiting for a token — all without spending a generation.
- To turn one picture of several objects into separate models, segment first, then call `model3d`
  once per cut-out picture. If `segment` answers that it needs a token, ask the person to fill in the
  plugin's `segment-token` setting rather than retrying.
- After delivering, load the GLB or the picture from the returned path and look at it in the preview.
  A generation is not verified because the file exists.
- Scale and pivot come as generated. To place it at metric size with the pivot at its base, pass the
  delivered GLB to `blender__model` with `model` set and transform it there rather than editing the
  export.

## What a refusal means

- **Nothing answered** (`nothing answered at …`): the intranet is unreachable from this Mac, or the
  address in the plugin's settings is wrong. Stop and tell the person; do not retry in a loop.
- **HTTP 401** on the model list: the `api-key` setting is missing or wrong.
- **HTTP 500 `argument after * must be an iterable, not NoneType`**: a malformed request to the shared
  route — the payload has to travel inside `args` as a list. This plugin always builds that itself, so
  seeing it means a hand-written `raw-infer` body; fix the body rather than assuming the server is
  broken.
- **HTTP 500 with a launcher message** (`[address=…] Hunyuan3D-2.1 requires one of: 'text' …`): the
  server is fine and is telling you what the payload lacked. Quote its words; do not retry the same
  payload.
- **`MODEL_LOGIN_EXPIRED`**: the segmentation service wants a platform user token. Tell the person.
- **larger than … bytes**: simplify the request — a plainer prompt, a smaller source picture.
