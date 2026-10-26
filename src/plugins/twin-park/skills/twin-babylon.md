# Babylon.js twin runtime

Babylon.js is the browser editing and operations target. Load the generated manifest and stream geometry by layer; do not make the browser scene the canonical data store.

Keep GIS coordinates in the project local ENU frame, attach Twin IR ids and property metadata to meshes, and bind telemetry by stable ids. Separate render layers from semantic objects so a layer can be reloaded without losing application state.

Use the existing Genex preview contract for readiness, and expose loading, coordinate errors, stale telemetry and disconnected sources as visible states.
