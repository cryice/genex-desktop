import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TwinElement,
  TwinObjectKind,
  TwinSceneClass,
  isTwinElement,
  isTwinObjectKind,
  isTwinSceneClass,
  twinElementKind,
  twinKindElements,
} from "../../src/shared/twin-elements.ts";

test("scene classes are park, city and workshop, and nothing else", () => {
  assert.deepEqual(Object.values(TwinSceneClass), ["park", "city", "workshop"]);
  assert.equal(isTwinSceneClass("park"), true);
  assert.equal(isTwinSceneClass("factory"), false);
  assert.equal(isTwinSceneClass(""), false);
});

test("every engineering element generates as a known kind", () => {
  for (const element of Object.values(TwinElement)) {
    assert.equal(isTwinElement(element), true);
    const kind = twinElementKind(element);
    assert.equal(isTwinObjectKind(kind), true);
  }
});

test("the element→kind mapping puts each element where its operator lives", () => {
  assert.equal(twinElementKind(TwinElement.Building), TwinObjectKind.Building);
  assert.equal(twinElementKind(TwinElement.Road), TwinObjectKind.Road);
  assert.equal(twinElementKind(TwinElement.Terrain), TwinObjectKind.Landscape);
  assert.equal(twinElementKind(TwinElement.Lamp), TwinObjectKind.VegetationLamp);
  assert.equal(twinElementKind(TwinElement.Camera), TwinObjectKind.Device);
  assert.equal(twinElementKind(TwinElement.Equipment), TwinObjectKind.Equipment);
  assert.equal(twinElementKind(TwinElement.ProductionLine), TwinObjectKind.ProductionLine);
});

test("kind→elements answers the operator picker and covers every kind with elements", () => {
  assert.ok(twinKindElements(TwinObjectKind.VegetationLamp).includes(TwinElement.Lamp));
  assert.ok(twinKindElements(TwinObjectKind.VegetationLamp).includes(TwinElement.Tree));
  assert.deepEqual([...twinKindElements(TwinObjectKind.Building)].sort(), ["building", "floor", "room"]);
  for (const kind of Object.values(TwinObjectKind))
    assert.ok(Array.isArray(twinKindElements(kind)), `${kind} answers an array`);
});

test("unknown values are refused, not coerced", () => {
  assert.equal(isTwinElement("tree"), true);
  assert.equal(isTwinElement("Tree"), false);
  assert.equal(isTwinObjectKind("building"), true);
  assert.equal(isTwinObjectKind("vehicle"), false);
});
