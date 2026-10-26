"""Export one object's USD layer to GLB through local Blender (the web route's exporter).

Blender's built-in USD importer reads the layer, and its glTF exporter writes the GLB the web
route loads — the same engine-agnostic package serving a second route (P6). The object keeps its
local origin and its name becomes the twin tag the page's scene checks read.
"""
import sys

try:
    import bpy
except Exception as error:  # pragma: no cover - runs inside Blender
    from common import fail

    fail("this job runs inside Blender: %s" % error)

from common import emit, fail


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        fail("usage: glb_wrapper.py <object.usdc> <object.glb> [name]")
    source, target = argv[0], argv[1]
    name = argv[2] if len(argv) > 2 else "object"
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.usd_import(filepath=source)
    except Exception as error:
        fail("Blender could not import the USD layer: %s" % error)
        return
    for obj in bpy.data.objects:
        obj.name = name
    try:
        bpy.ops.export_scene.gltf(filepath=target, export_format="GLB", export_yup=False)
    except Exception as error:
        fail("Blender could not export the GLB: %s" % error)
        return
    import os

    if not os.path.isfile(target):
        fail("the GLB was not written")
        return
    emit({"ok": True, "objects": len(bpy.data.objects), "bytes": os.path.getsize(target), "name": name})


main()
