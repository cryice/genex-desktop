"""Convert a DWG to DXF through the ODA File Converter (or pass a DXF through).

ODA's converter is a folder-in, folder-out command line tool, and it is proprietary-free but not
redistributable: it is called as an independent process the user installed, never packaged with
the studio (the license table's rule). A `.dxf` input is passed through unchanged, so the adapter
chain is idempotent.
"""
import os
import shutil
import subprocess
import sys

from common import emit, fail

# ODA's output version and format arguments.
ODA_VERSION = "ACAD2018"
ODA_FORMAT = "DXF"
# How long the converter may take, in seconds.
ODA_TIMEOUT_S = 170


def main():
    if len(sys.argv) < 3:
        fail("usage: dwg_dxf.py <drawing.dwg> <drawing.dxf> [converter_path]")
    source, target = sys.argv[1], sys.argv[2]
    converter = sys.argv[3] if len(sys.argv) > 3 else ""
    if source.lower().endswith(".dxf"):
        shutil.copyfile(source, target)
        emit({"ok": True, "converted": False, "note": "input was already DXF"})
        return
    if not converter or not os.path.isfile(converter):
        fail("the ODA File Converter was not found: install it and point twin-park's dwgProgram setting at it")
    out_dir = os.path.dirname(os.path.abspath(target)) or "."
    try:
        completed = subprocess.run(
            [converter, os.path.dirname(os.path.abspath(source)), out_dir, ODA_VERSION, ODA_FORMAT, "0", "0"],
            capture_output=True,
            text=True,
            timeout=ODA_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        fail("the ODA File Converter timed out after %ds" % ODA_TIMEOUT_S)
        return
    produced = os.path.join(out_dir, os.path.splitext(os.path.basename(source))[0] + ".dxf")
    if not os.path.isfile(produced):
        fail("the ODA File Converter produced no DXF: %s" % (completed.stderr or completed.stdout or "no output").strip()[:400])
        return
    if os.path.abspath(produced) != os.path.abspath(target):
        shutil.move(produced, target)
    emit({"ok": True, "converted": True, "bytes": os.path.getsize(target), "log": (completed.stdout or "").strip()[:200]})


main()
