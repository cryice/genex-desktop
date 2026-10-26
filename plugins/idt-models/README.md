# IDT Intranet Models — a Genex plugin

Gives Genex's game-building agent tools that generate 3D models and pictures on the IDT intranet GPU
servers and deliver them into the game's own assets.

## What actually works (measured, not assumed)

Every model is reached through **one** route, and every row below was called live on 2026-10-14
through this plugin's own code (`check.mjs`), not through curl.

| model | payload inside `args` | answer | measured |
| --- | --- | --- | --- |
| `hunyuan3d-2.1` | `{"image": "<base64>"}` | `{model_base64: GLB, obj_base64, texture_image_base64, metallic_base64, roughness_base64, stats}` | **200 — a 4.1 MB glTF v2, 55.3 s, `has_texture: true`** |
| `trellis2-4b` | `{"image": "<base64>"}` | `{model_base64: GLB}` | **200 — a 34.4 MB glTF v2** |
| `flux-2-klein-4b` | `{"prompt": "…"}` | `{image, image_base64}` | **200 — a 322 KB PNG, ~10 s** |
| `qwen-image-edit` | `{"prompt": "…", "image": "<base64>"}` | `{front, left, top, perspective}` | **200 — four PNGs, 658–855 KB each** |
| segmentation | `{"image": "<data-url>", "prompt"?: "…"}` → a job; poll `/v1/jobs/{id}`, fetch `/v1/jobs/{id}/files/{name}` | | `401 {"code":"MODEL_LOGIN_EXPIRED"}` until a **platform user token** is set |

`text_to_3d` and `multiview_to_3d` on `hunyuan3d-2.1` are implemented from the launcher's own words
(“requires one of: 'text' …, 'image' …, or 'mv_image_front'…”) but have not been exercised end to end;
the two image_to_3d paths have.

## The one shape the route wants

```
POST {base-url}/v1/flexible/infers
{"model": "<model_uid>", "args": [ <that model's own payload> ]}
```

`args` must be present, and must be a list. The route unpacks it into the model's `infer`
(`infer(*args, **kwargs)`), so a payload carried anywhere else leaves `args` as `None` and dies inside
the actor about 15 ms in, before any GPU work:

```
500 {"detail":"<xoscar.core.ActorRefMethod object at 0x…> argument after * must be an iterable, not NoneType"}
```

That message reads exactly like a route with no implementation, and an earlier version of this plugin
concluded it was one — that `/v1/flexible/infers` was registered but unfinished, so Hunyuan3D needed
the algorithm team. **It did not.** With `args` in place every launcher answers in its own words:

```
{"model":"hunyuan3d-2.1","args":[{}]}
  → 500 [address=10.108.15.66:43101, pid=2189660] Hunyuan3D-2.1 requires one of: 'text' (prompt string), 'image' (base64) for single-image mode, or 'mv_image_front'/'mv_image_back'/'mv_image_left'/'mv_image_right' for multi-view mode.
```

`probe-inference.mjs` is the experiment that settles it: it sends a matrix of shapes and, after each
one, reads the model's event log, so you can see which shapes reach a launcher and which die in the
actor. `status` now uses the same trick with an empty payload — every 3D launcher refuses an empty
payload without generating anything — and reports `flexibleRoute.reachesLauncher`.

Two things that misled the earlier reading, worth not repeating:

- **“No `requestBody` in `/openapi.json`” means nothing here.** `/v1/chat/completions` and
  `/v1/completions` declare none either. That document is not evidence about what a route implements.
- **The picture format is forgiving.** Both launchers take a picture as bare base64 or as a `data:`
  URL; probed with a non-image, both forms fail identically, so the prefix is normalised before
  decoding. This plugin sends bare base64.

## Tools

| Tool | What it does |
| --- | --- |
| `idt-models__status` | Lists the loaded models and their tasks, proves the shared route reaches a launcher, reads the segmentation health and whether it wants a token, and reads the GPU probe. Generates nothing |
| `idt-models__model3d` | A picture (or a prompt, or four views) → a GLB delivered into `assets/` |
| `idt-models__image` | A prompt, and optionally a picture, → one PNG, or the editing model's four views, delivered |
| `idt-models__segment` | A picture → one picture per object, delivered (needs the platform token) |
| `idt-models__raw-infer` | A hand-written body to the shared route, for trying a shape this plugin does not send (asks first) |

## Files

| File | What it is |
| --- | --- |
| `plugin.json` | The manifest: five tools, five settings, `network.hosts`, the skill entry |
| `backend.mjs` | The tools, in plain JavaScript (a plugin backend is not TypeScript) |
| `skills/idt-models.md` | What the agent reads about when to generate rather than model by hand |
| `check.mjs` | One command to exercise any tool against the live servers with a stand-in host |
| `probe-inference.mjs` | The shape experiment behind the section above |

## Loading it

```sh
cp -R plugins/idt-models "<game folder>/genex-plugins/idt-models"
```

Then **Plugins → Add → Load local plugin…**, pick the folder, and read the trust dialog — it names
the three intranet hosts. The plugin starts **off**; turn it on for the game you want it in.

Check it before that, the way Studio does, and then for real:

```sh
npm run plugin:doctor -- plugins/idt-models
node plugins/idt-models/check.mjs                                             # status, nothing generated
node plugins/idt-models/check.mjs image name=cube prompt="a red cube"         # ~10 s, one PNG
node plugins/idt-models/check.mjs model3d name=prop image=assets/concept.png  # ~56 s, one GLB
```

## Settings

| Key | Default | Notes |
| --- | --- | --- |
| `base-url` | `http://10.108.15.66:9997` | The Xinference. A trailing `/v1` is accepted and stripped |
| `api-key` | *(empty)* | The Bearer key. **Type it in Settings — never in this file**, which is version-controlled |
| `segment-url` | `http://10.108.15.66:18092` | GroundingDINO + SAM2 |
| `segment-token` | *(empty)* | The platform user token that service wants; without it `segment` reports `MODEL_LOGIN_EXPIRED` |
| `gpu-url` | `http://10.108.15.66:18091` | The free-memory probe |

Every generation goes through `base-url`, so the addresses of the real backends (`61:8090` for the
picture models, `61:8091` for TRELLIS.2) are the algorithm team's business and not a setting here.

The key is stored by Studio in the plugin's own store, not in `plugin.json`. It is **not**
keychain-backed; moving it to the OS secret store is the `credentials` capability plus a small
settings panel, if you want that later. Pointing an address at a **different host** means adding that
host to `network.hosts` too — the install-time scan reports a literal `http://host` that is undeclared.

## Deliberate choices worth knowing

- **Generation tools carry no consent card**, because a card on every call would stop an unattended
  Loop from building. Only `raw-infer` asks, since its body is arbitrary. A shared GPU is a real
  cost, so the skill tells the agent to generate once and reuse.
- **Pictures are read from the bound game with `node:fs`**, because `project.read` returns text and an
  image is bytes. The path is checked first: relative, no `..`, no absolute path. This is
  trusted-code behaviour, disclosed at install.
- **Pictures are found by shape, not by field name.** One service answers one picture under two names
  (`image` and `image_base64`, the same bytes); the editing service answers four views (`front`,
  `left`, `top`, `perspective`). Identical bytes are kept once, so flux delivers one file and a qwen
  edit delivers four, named after the field each came in.
- **A `base64` GLB is decoded to bytes before delivery** — `assets.deliver` copies files, and the
  response cap (140 MB) is set above the asset cap (100 MB) so a third of base64 overhead cannot
  silently truncate a model.
- **No `nativeJobs` entry**, on purpose: a managed job's sandbox denies network, so the calls have to
  happen in the backend.
