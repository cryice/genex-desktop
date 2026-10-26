/**
 * The studio contract for a twin page — the things only the park knows, exposed so the harness
 * can look, judge and drive it.
 *
 * The studio attaches to whatever a page renders on its own (stepping, capturing, inspecting);
 * this file adds what a twin knows and a game does not: the scene class, the asset count by
 * element, which floor drawer is open, which time-of-day variant is up, and the live binding
 * state. A game's `flow.playing` is meaningless here, so `state()` reports the twin's own
 * posture instead.
 *
 * Keep this file intact and extend it (new probes, new cameras): every method is something the
 * harness calls. Tag every loaded asset with its element id (`B_0001`, `Lamp_0007`…) — the
 * scene checks read those tags, and an untagged asset is invisible to them.
 */

import { sendCommand } from "./iot.js";

/** The time-of-day variants a park ships with; the first is the default. */
export const TIME_OF_DAY = Object.freeze(["day", "dusk", "night"]);

/**
 * Attach the contract for a park scene. `scene` is the Babylon scene, `park` the manifest and
 * `live` the binding state `startBindings` returned.
 */
export function installStudio({ scene, engine, park, live }) {
  const drawer = { open: null };
  const timeOfDay = { current: TIME_OF_DAY[0] };

  /** The meshes that carry a tag, as the scene checks read them. */
  function tagged() {
    const meshes = [];
    for (const mesh of scene.getMeshes()) {
      const tag = mesh.metadata?.twinTag;
      if (!tag) continue;
      const info = mesh.getBoundingInfo();
      meshes.push({
        tag,
        name: mesh.name,
        min: [info.minimum.x, info.minimum.y, info.minimum.z],
        max: [info.maximum.x, info.maximum.y, info.maximum.z],
        size: [info.maximum.x - info.minimum.x, info.maximum.y - info.minimum.y, info.maximum.z - info.minimum.z],
        enabled: mesh.isEnabled(),
      });
    }
    return meshes;
  }

  /** The floor drawer: show one floor's meshes, or all when `index` is null. */
  function setFloor(index) {
    drawer.open = index;
    for (const mesh of scene.getMeshes()) {
      const floor = mesh.metadata?.twinFloor;
      if (floor === undefined) continue;
      mesh.setEnabled(index === null || floor === index);
    }
  }

  /** The time-of-day variant: the park's layers switch visibility by their `twinTime` metadata. */
  function setTimeOfDay(name) {
    if (!TIME_OF_DAY.includes(name)) return false;
    timeOfDay.current = name;
    for (const node of scene.transformNodes) {
      if (node.metadata?.twinTime === undefined) continue;
      node.setEnabled(node.metadata.twinTime === name || node.metadata.twinTime === "all");
    }
    return true;
  }

  window.__studio = {
    version: 2,
    state: () => ({
      sceneClass: park?.sceneClass ?? "park",
      flow: { playing: true },
      assets: tagged().length,
      bindings: { connected: live?.connected === true, applied: live?.applied ?? 0, skipped: live?.skipped ?? 0 },
      drawer: { ...drawer },
      timeOfDay: { ...timeOfDay },
      fps: engine.getFps().toFixed(1),
    }),
    scene: () => ({ meshes: tagged(), count: tagged().length }),
    cameras: () => ({
      orbit: { name: "orbit", radius: 220, target: [0, 0, 0] },
      hero: { name: "hero", radius: 60, target: [0, 12, 0] },
    }),
    setFloor,
    setTimeOfDay,
    timeOfDayVariants: () => [...TIME_OF_DAY],
    /**
     * Reverse control to a device (write a property back through the feed). `confirm` must be true
     * for a `reverse` binding — the harness answers a confirmation card before any physical write.
     */
    control: (device, property, value, confirm = false) => sendCommand(scene, park, device, property, value, confirm),
    hud: (lines) => {
      window.__studio_hud = Array.isArray(lines) ? lines.slice(0, 12) : [];
    },
  };
  return window.__studio;
}
