/**
 * The park manifest: what the page shows and what it is bound to.
 *
 * `park.json` is the twin's scene list for the web route — the same scene the USD stage
 * (`stage`) describes, in the form Babylon consumes. It is written by the twin-park plugin
 * (`iot-bind`, `export-glb`) and read here; an agent building a park edits the stage through
 * the operators, never this file by hand except to point at a new GLB.
 *
 * The bindings are the twin's heart: a prim path, a device, a property and the scene target it
 * drives. `iot.js` applies them; the same keys travel into `twin_manifest.json` for UE5 and the
 * business systems, so one binding serves every route.
 */
export const PARK_MANIFEST_VERSION = 1;

/** One asset the page loads: an exported GLB, tagged with the element it is. */
export function assetEntries(park) {
  return Array.isArray(park?.assets) ? park.assets : [];
}

/** The bindings a park declares, each a prim, a device and the target it drives. */
export function bindingEntries(park) {
  return Array.isArray(park?.bindings) ? park.bindings : [];
}

/** The render targets this park is delivered to; `babylon` is this page, `unreal` the UE5 route. */
export function renderTargets(park) {
  const targets = Array.isArray(park?.renderTargets) ? park.renderTargets : [];
  return targets.length > 0 ? targets : ["babylon"];
}

/** Whether a manifest is one this page can render: version, scene class and a stage name. */
export function isParkManifest(value) {
  if (typeof value !== "object" || value === null) return false;
  return (
    value.version === PARK_MANIFEST_VERSION &&
    typeof value.sceneClass === "string" &&
    ["park", "city", "workshop"].includes(value.sceneClass) &&
    typeof value.stage === "string"
  );
}

/** The site's local frame, for the readout and for any geo-aware layer. */
export function georef(park) {
  return park?.georef ?? { crs: "CGCS2000", local: { lat: 0, lon: 0, height: 0 } };
}

/** Read this page's `park.json`; a manifest this page cannot render is a throw the page shows. */
export async function loadPark(url = "/park.json") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`park.json: HTTP ${response.status}`);
  return response.json();
}
