# Twin modeling backends

Use Twin IR as the source of truth. Choose one modeling backend per deliverable:

- **OpenUSD** for layered, georeferenced scene composition, variant sets, references and downstream interchange.
- **Blender** for procedural geometry, asset cleanup, material authoring and exports such as GLB.

Keep geometry generation deterministic and preserve each object's local origin, units, coordinate frame and provenance. Do not hand-edit renderer output as the source of truth; write the IR or modeling inputs and rebuild the layer.
