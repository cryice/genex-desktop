import assert from "node:assert/strict";
import { test } from "node:test";
import { TwinElement, TwinSceneClass } from "../../src/shared/twin-elements.ts";
import { TwinElementStandards, TwinScenePrecision } from "../../src/shared/twin-ontology.ts";

test("every twin element has a complete standard crosswalk", () => {
  for (const element of Object.values(TwinElement)) {
    const standard = TwinElementStandards[element];
    assert.ok(standard, `missing standard crosswalk for element: ${element}`);
    assert.ok(standard.citygml, `missing CityGML class for ${element}`);
    assert.ok(standard.ifc, `missing IFC entity for ${element}`);
    assert.ok(standard.cim, `missing CJJ/T 318 class for ${element}`);
    assert.ok(standard.gbt51269, `missing GB/T 51269 domain for ${element}`);
    assert.ok(standard.citygmlLod, `missing CityGML LOD for ${element}`);
    assert.ok(standard.bimLod, `missing BIM LOD for ${element}`);
  }
});

test("every scene class has a precision bracket", () => {
  for (const scene of Object.values(TwinSceneClass)) {
    const precision = TwinScenePrecision[scene];
    assert.ok(precision, `missing precision bracket for scene: ${scene}`);
    assert.ok(precision.citygml, `missing CityGML LOD for ${scene}`);
    assert.ok(precision.bim, `missing BIM LOD for ${scene}`);
    assert.ok(precision.note, `missing guidance note for ${scene}`);
  }
});

test("scene precision brackets descend from city to workshop", () => {
  assert.ok(TwinScenePrecision.city.citygml.startsWith("LOD1"));
  assert.equal(TwinScenePrecision.park.citygml, "LOD2");
  assert.ok(TwinScenePrecision.workshop.citygml.startsWith("LOD3"));
});
