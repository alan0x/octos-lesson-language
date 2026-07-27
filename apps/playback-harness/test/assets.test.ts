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
