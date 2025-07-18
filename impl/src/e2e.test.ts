import { Backend } from "./backend";

import { strict as assert } from "assert";
import test from "node:test";
import { Temporal } from "temporal-polyfill";

void test("e2e", () => {
  const site = "https://a.example";
  const intermediarySite = undefined;
  let now = new Temporal.Instant(0n);

  const ppa = new Backend({
    aggregationServices: new Map([["", { protocol: "dap-15-histogram" }]]),
    includeUnencryptedHistogram: true,

    maxConversionSitesPerImpression: 10,
    maxConversionCallersPerImpression: 10,
    maxCreditSize: Infinity,
    maxLifetimeDays: 30,
    maxLookbackDays: 60,
    maxHistogramSize: 100,
    privacyBudgetMicroEpsilons: 1000000,

    now: () => now,
    random: () => 0.5,
  });

  ppa.saveImpression(site, intermediarySite, { histogramIndex: 0 });

  now = now.add({ seconds: 1 });

  ppa.saveImpression(site, intermediarySite, { histogramIndex: 1 });

  now = now.add({ seconds: 1 });

  const { unencryptedHistogram } = ppa.measureConversion(
    site,
    intermediarySite,
    {
      aggregationService: "",
      histogramSize: 3,
      value: 5,
      maxValue: 10,
    },
  );
  assert.deepEqual(unencryptedHistogram, [0, 5, 0]);
});
