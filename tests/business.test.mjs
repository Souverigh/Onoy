import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_TYPES,
  MODULE_IDS,
  PRESETS,
  businessType,
  isModuleId,
  moduleOverrides,
  navLabel,
  resolveModules,
} from "../src/lib/business.ts";

test("business: a shop without a type (every shop before the migration) keeps every section and its names", () => {
  assert.equal(businessType(null), "shop");
  assert.deepEqual(resolveModules(null, null), MODULE_IDS);
  assert.deepEqual(resolveModules(undefined, []), MODULE_IDS);
  for (const [href, label] of [["/stock", "Склад"], ["/orders", "Заказы"], ["/customers", "Клиенты"]])
    assert.equal(navLabel(businessType(null), href, label), label);
});

test("business: a type this code does not know (database ahead of code) works as a shop", () => {
  assert.equal(businessType("spaceship"), "shop");
  assert.equal(businessType(42), "shop");
  assert.deepEqual(resolveModules("spaceship", null), resolveModules(null, null));
});

test("business: every preset names known modules and a label", () => {
  for (const type of BUSINESS_TYPES) {
    assert.ok(PRESETS[type].label, type);
    assert.ok(PRESETS[type].modules.every(isModuleId), type);
    assert.match(type, /^[a-z][a-z0-9_]{0,39}$/, "id fits the database check");
  }
});

test("business: owner overrides switch modules on and off, garbage is ignored", () => {
  assert.deepEqual(resolveModules("restaurant", null), ["stock"]);
  assert.deepEqual(resolveModules("restaurant", ["+catalog"]), ["stock", "catalog"]);
  assert.deepEqual(resolveModules("shop", ["-catalog"]), ["stock"]);
  assert.deepEqual(resolveModules("shop", ["-stock", "-catalog"]), []);
  assert.deepEqual(resolveModules("shop", ["+rocket", "catalog", "-", "-nothing"]), MODULE_IDS);
});

test("business: overrides saved from the chosen switches give back exactly those switches", () => {
  const subsets = MODULE_IDS.reduce((all, id) => all.concat(all.map((s) => [...s, id])), [[]]);
  for (const type of BUSINESS_TYPES)
    for (const chosen of subsets) {
      const overrides = moduleOverrides(type, chosen);
      assert.deepEqual(resolveModules(type, overrides), MODULE_IDS.filter((id) => chosen.includes(id)), `${type} ${chosen}`);
      if (chosen.length === PRESETS[type].modules.length && chosen.every((id) => PRESETS[type].modules.includes(id)))
        assert.deepEqual(overrides, [], "the preset itself needs no overrides");
    }
});

test("business: a cafe calls stock «Продукты», other sections keep their names", () => {
  assert.equal(navLabel("restaurant", "/stock", "Склад"), "Продукты");
  assert.equal(navLabel("restaurant", "/customers", "Клиенты"), "Клиенты");
});
