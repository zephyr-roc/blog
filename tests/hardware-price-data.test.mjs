import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(await readFile("data/deep-radar-hardware-prices-cn.json", "utf8"));

test("keeps six auditable mainland hardware price series", () => {
  assert.deepEqual(
    data.series.map((series) => series.category),
    ["CPU", "GPU", "主板", "DRAM", "HDD", "SSD"]
  );

  for (const series of data.series) {
    assert.ok(series.product.length > 0);
    assert.ok(series.observations.length > 0);
    const dates = series.observations.map((item) => item.date);
    assert.deepEqual(dates, [...dates].sort());

    for (const observation of series.observations) {
      assert.match(observation.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(observation.price > 0);
      assert.match(observation.source, /^https:\/\//);
      assert.ok(observation.kind.length > 0);
      assert.ok(observation.merchant.length > 0);
    }
  }
});
