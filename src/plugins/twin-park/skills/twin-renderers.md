# Twin renderer targets

A renderer consumes the same Twin IR and manifest:

- Babylon.js is the editable browser preview and data application target.
- Godot is the lightweight cross-platform runtime target.
- Unreal is the high-fidelity simulation and large-scene target.

Adapters translate entities, transforms, materials, metadata and IoT bindings without changing the IR. Keep engine-specific files in generated output or adapter folders, never in the canonical twin data.
