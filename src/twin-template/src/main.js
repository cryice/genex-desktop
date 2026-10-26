/**
 * The park page's entry: load the manifest, build the Babylon scene, load every exported GLB,
 * start the live bindings and attach the studio contract.
 *
 * The page is a viewer, not an editor: geometry comes from the exported assets (GLB), the scene
 * comes from `park.json`, and the only things this file decides are the camera, the lights and
 * the loop. A park that needs its own interaction (picking a building, a UI panel) grows here —
 * the contract in `studio.js` is what it exposes to the harness.
 */
import { assetEntries, georef, isParkManifest, loadPark, renderTargets } from "./park.js";
import { startBindings } from "./iot.js";
import { installStudio } from "./studio.js";

const canvas = document.getElementById("view");

async function boot() {
  const park = await loadPark();
  if (!isParkManifest(park)) throw new Error("park.json is not a manifest this page can render");
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.043, 0.055, 0.078, 1);

  const camera = new BABYLON.ArcRotateCamera("orbit", -Math.PI / 2, 1.05, 220, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 20;
  camera.upperRadiusLimit = 800;
  camera.wheelDeltaPercentage = 0.02;

  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.6, -1, 0.45), scene);
  sun.intensity = 0.9;

  // Every asset the manifest names, tagged with the element it is: the scene checks read tags.
  const assets = assetEntries(park);
  await Promise.all(
    assets.map(async (asset) => {
      const result = await BABYLON.SceneLoader.AppendMeshAsync("", asset.glb, scene);
      for (const mesh of result.meshes) {
        mesh.metadata = { ...(mesh.metadata ?? {}), twinTag: asset.id, twinElement: asset.element ?? null };
        if (asset.floor !== undefined) mesh.metadata.twinFloor = asset.floor;
      }
      const root = result.meshes[0];
      if (root && asset.position) root.position = new BABYLON.Vector3(...asset.position);
    }),
  );

  const live = startBindings(scene, park);
  installStudio({ scene, engine, park, live });

  const site = georef(park);
  const targets = renderTargets(park);
  scene.metadata = { twin: { site, targets } };
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  window.__park_ready = { assets: assets.length, site, targets };
}

boot().catch((error) => {
  const box = document.getElementById("fatal");
  box.style.display = "grid";
  box.textContent = `${error.message}\n\n${error.stack ?? ""}`;
  window.__studio_error = { message: error.message, stack: error.stack ?? "" };
});
