/**
 * The live side of a twin: device properties in, scene targets out.
 *
 * A park is not a recording — a lamp's emissive follows its device's brightness, a gate's
 * rotation follows its controller. `park.json`'s bindings say which prim, which device, which
 * property and which scene target; this module keeps the feed and applies the values.
 *
 * The transport is deliberately one configurable line: `feed` in park.json names a WebSocket
 * (the JetLinks gateway's MQTT-over-WebSocket endpoint) and a topic, and messages arrive as
 * `{ device, property, value }`. Nothing here knows JetLinks' protocol — the plugin's `iot-bind`
 * tool writes the endpoint, and a different gateway is a different `feed`, not a rewrite.
 *
 * Applying a value never throws into the render loop: an unknown target is skipped and counted,
 * and the last N applications are kept for the studio contract's readout.
 */
import { bindingEntries } from "./park.js";

const MAX_RECENT = 20;

/** The node a binding's prim resolves to: the exported asset carries its object id as `twinTag`. */
export function findNode(scene, prim) {
  const last = String(prim ?? "").replace(/^.*\//, "");
  for (const mesh of scene.getMeshes()) {
    const tag = mesh.metadata?.twinTag;
    if (tag === prim || tag === last) return mesh;
  }
  return scene.getNodeByName(last) ?? null;
}

/** Start the bindings of a park against a scene; returns the live binding state. */
export function startBindings(scene, park) {
  const state = { connected: false, applied: 0, skipped: 0, recent: [] };
  const bindings = bindingEntries(park);
  if (bindings.length === 0) return state;
  const byPrim = new Map();
  for (const binding of bindings) {
    const node = findNode(scene, binding.prim);
    if (!node) {
      state.skipped += 1;
      continue;
    }
    const list = byPrim.get(binding.device) ?? [];
    list.push({ binding, node });
    byPrim.set(binding.device, list);
  }
  const feed = park?.feed;
  if (feed?.kind === "websocket" && typeof feed.url === "string") {
    const socket = new WebSocket(feed.url);
    scene.__twinFeed = socket;
    socket.addEventListener("open", () => {
      state.connected = true;
      if (typeof feed.topic === "string") socket.send(JSON.stringify({ type: "subscribe", topic: feed.topic }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      for (const entry of byPrim.get(message?.device) ?? [])
        applyProperty(scene, entry, message.property, message.value, state);
    });
    socket.addEventListener("close", () => {
      state.connected = false;
    });
  }
  return state;
}

/** Apply a material channel value; an unusable channel is skipped (returns false), never thrown. */
function applyMaterial(node, field, value, state) {
  if (!node.material) return false;
  const channel = field === "emissive" ? "emissiveColor" : field;
  if (node.material[channel]?.copyFrom && typeof value === "object") node.material[channel].copyFrom(value);
  else if (node.material[channel] !== undefined && typeof value === "number") node.material[channel] = value;
  else {
    state.skipped += 1;
    return false;
  }
  return true;
}

/** The scene targets a binding may drive, each as a small applier; an unknown target is skipped. */
const TARGET_APPLIERS = {
  position: (node, field, value) => {
    node.position[field] = Number(value);
    return true;
  },
  rotation: (node, field, value) => {
    node.rotation[field] = Number(value);
    return true;
  },
  scaling: (node, field, value) => {
    node.scaling[field] = Number(value);
    return true;
  },
  material: (node, field, value, state) => applyMaterial(node, field, value, state),
  visibility: (node, _field, value) => {
    node.setEnabled(Number(value) > 0);
    return true;
  },
};

/** Record one applied value in the binding state, capped to the most recent MAX_RECENT. */
function recordApplied(state, binding, property, value) {
  state.applied += 1;
  state.recent.unshift(`${binding.device}.${property}=${JSON.stringify(value)}`);
  if (state.recent.length > MAX_RECENT) state.recent.length = MAX_RECENT;
}

/** Apply one property value to the node its binding names; an unknown target is skipped, not thrown. */
export function applyProperty(scene, entry, property, value, state) {
  const { binding, node } = entry;
  if (property !== binding.property) return;
  const [kind, field] = String(binding.target ?? "").split(".");
  try {
    const applier = TARGET_APPLIERS[kind];
    const applied = applier ? applier(node, field, value, state) : false;
    if (applied === false) {
      state.skipped += 1;
      return;
    }
    recordApplied(state, binding, property, value);
  } catch {
    state.skipped += 1;
  }
}

/**
 * Reverse control: a twin that holds a `reverse` binding may also write a property back to the
 * device. The write goes out on the same feed channel. A reverse write needs an explicit
 * `confirm` — the harness answers a confirmation card before flipping a physical device. The
 * transport is the park's `feed`; an MQTT-over-WebSocket gateway receives `{ device, property, value }`.
 */
export function sendCommand(scene, park, device, property, value, confirm = false) {
  const feed = park?.feed;
  const socket = scene.__twinFeed;
  if (!socket || socket.readyState !== 1) return { ok: false, reason: "feed not connected" };
  const binding = (bindingEntries(park) ?? []).find((entry) => entry.device === device && entry.property === property);
  if (!binding) return { ok: false, reason: "no such binding" };
  if (binding.reverse !== true) return { ok: false, reason: "binding is read-only (no reverse control)" };
  if (!confirm) return { ok: false, reason: "reverse control requires confirmation" };
  socket.send(JSON.stringify({ type: "command", device, property, value }));
  return { ok: true, device, property, value };
}
