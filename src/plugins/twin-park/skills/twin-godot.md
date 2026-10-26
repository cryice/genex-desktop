# Godot twin runtime

Godot is the lightweight cross-platform runtime target. Generate a reproducible project and scene resources from Twin IR and the twin manifest.

Use one node identity for each Twin IR object, keep engineering properties in metadata/resources, and keep device bindings in a separate runtime service. Use local ENU metres in the scene; retain the Earth anchor in the manifest.

Runtime data must distinguish telemetry, historical replay, alarms and commands. Commands require an explicit permission path and an audit event.
