import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveHarnessAsset } from "../src/assets.js";

test("controlled science asset resolves to a local image and normalized regions", async () => {
  const asset = resolveHarnessAsset("asset-transpiration-control-001");
  assert.ok(asset);
  assert.equal(asset.src, "/examples/science-transpiration-v2/assets/transpiration-control.png");
  await access(resolve(process.cwd(), asset.src.slice(1)));
  assert.equal(asset.intrinsic_width / asset.intrinsic_height, 1.5);
  assert.ok(Object.keys(asset.regions).length >= 5);
  for (const bounds of Object.values(asset.regions)) {
    assert.ok(bounds.x >= 0 && bounds.y >= 0);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.x + bounds.width <= 1);
    assert.ok(bounds.y + bounds.height <= 1);
  }
});

test("learner ink snapshot assets resolve to local SVGs with normalized regions", async () => {
  for (const id of ["asset-learner-ink-card1", "asset-learner-ink-card3"]) {
    const asset = resolveHarnessAsset(id);
    assert.ok(asset);
    await access(resolve(process.cwd(), asset.src.slice(1)));
    assert.equal(Object.keys(asset.regions).length, 2);
    for (const bounds of Object.values(asset.regions)) {
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.width > 0 && bounds.height > 0);
      assert.ok(bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);
    }
  }
});

test("learner ink snapshots resolve to local SVGs whose selections lie inside them", async () => {
  for (const id of ["ink-snap:card1@v4", "ink-snap:card2-circle-a@v4", "ink-snap:card3@v4"]) {
    const asset = resolveHarnessAsset(id);
    assert.ok(asset, id);
    await access(resolve(process.cwd(), asset.src.slice(1)));
    for (const bounds of Object.values(asset.regions)) {
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);
    }
  }
});
