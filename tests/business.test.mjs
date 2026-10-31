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
  quickActions,
  mainAction,
  word,
  businessBySlug,
} from "../src/lib/business.ts";

test("business: a shop without a type (every shop before the migration) keeps every section and its names", () => {
  assert.equal(businessType(null), "shop");
  // Ровно то, что было до видов бизнеса: склад и каталог, без новых модулей.
  assert.deepEqual(resolveModules(null, null), ["stock", "catalog"]);
  assert.deepEqual(resolveModules(undefined, []), ["stock", "catalog"]);
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
  assert.deepEqual(resolveModules("restaurant", null), ["stock", "kitchen"]);
  assert.deepEqual(resolveModules("restaurant", ["+catalog"]), ["stock", "catalog", "kitchen"]);
  assert.deepEqual(resolveModules("restaurant", ["-kitchen"]), ["stock"]);
  assert.deepEqual(resolveModules("shop", ["-catalog"]), ["stock"]);
  assert.deepEqual(resolveModules("shop", ["-stock", "-catalog"]), []);
  assert.deepEqual(resolveModules("shop", ["+rocket", "catalog", "-", "-nothing"]), ["stock", "catalog"]);
  assert.deepEqual(resolveModules("shop", ["+variants"]), ["stock", "catalog", "variants"]);
  assert.deepEqual(resolveModules("clothing_rental", null), ["stock", "catalog", "variants", "rental"]);
  assert.deepEqual(resolveModules("clothing", null), ["stock", "catalog", "variants"]);
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

test("business: home buttons and the main button follow the type, a switched-off module falls back to the shop", () => {
  const ids = (list) => list.map((a) => a.id);
  assert.deepEqual(ids(quickActions("shop", ["stock", "catalog"])), ["sales", "purchases", "payment_in", "payment_out", "expense"]);
  assert.equal(mainAction("shop", ["stock"]).label, "Продажа");
  const rental = resolveModules("clothing_rental", null);
  assert.deepEqual(ids(quickActions("clothing_rental", rental)).slice(0, 2), ["rental_issue", "rentals"]);
  assert.deepEqual(mainAction("clothing_rental", rental), {
    id: "rental_issue",
    href: "/rentals/new",
    label: "Выдать",
    side: "customers",
    hint: "Вещи клиенту на несколько дней",
    icon: "hanger",
  });
  // Блоки главной: у магазина есть и клиенты, и поставщики, у проката — только клиенты; расход — один, свой.
  const sides = (list) => [...new Set(list.map((a) => a.side))].sort();
  assert.deepEqual(sides(quickActions("shop", ["stock", "catalog"])), ["customers", "shop", "suppliers"]);
  assert.deepEqual(sides(quickActions("clothing_rental", rental)), ["customers", "shop"]);
  assert.equal(quickActions("shop", ["stock"]).filter((a) => a.side === "shop").length, 1);
  // Прокат выключили — главная как у магазина, внизу «Продажа».
  const off = resolveModules("clothing_rental", ["-rental"]);
  assert.deepEqual(ids(quickActions("clothing_rental", off)).slice(0, 2), ["sales", "purchases"]);
  assert.equal(mainAction("clothing_rental", off).id, "sale");
});

test("business: own words where the type has them, the usual word elsewhere", () => {
  assert.equal(word("restaurant", "purchase"), "Закупка продуктов");
  assert.equal(word("shop", "purchase"), "Товар от поставщика");
  assert.equal(quickActions("restaurant", ["stock"]).find((a) => a.id === "purchases").label, "Закупка продуктов");
});

test("business: every type has its own sign-up address", () => {
  const slugs = BUSINESS_TYPES.map((t) => PRESETS[t].slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of slugs) assert.match(slug, /^[a-z]{2,20}$/);
  assert.equal(businessBySlug("prokat"), "clothing_rental");
  assert.equal(businessBySlug("../admin"), null);
});
