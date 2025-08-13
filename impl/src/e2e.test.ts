import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
  AttributionProtocol,
} from "./index";

import { Backend, days } from "./backend";

import { strict as assert } from "assert";
import { glob, readFile } from "node:fs/promises";
import test from "node:test";
import { Temporal } from "temporal-polyfill";

interface TestSuite {
  name: string;
  options: TestOptions;
  cases: TestCase[];
}

interface TestOptions {
  aggregationServices: Record<string, AttributionProtocol>;
  maxConversionSitesPerImpression: number;
  maxConversionCallersPerImpression: number;
  maxCreditSize: number;
  maxLifetimeDays: number;
  maxLookbackDays: number;
  maxHistogramSize: number;
  privacyBudgetMicroEpsilons: number;
  privacyBudgetEpochDays: number;
}

interface TestCase {
  name: string;
  events: Event[];
}

type Event = {
  seconds: number;
  site: string;
  intermediarySite?: string | undefined;
} & (SaveImpression | MeasureConversion);

interface SaveImpression {
  event: "saveImpression";
  options: AttributionImpressionOptions;
  // TODO: Support checking for errors.
}

interface MeasureConversion {
  event: "measureConversion";
  options: AttributionConversionOptions;
  // TODO: Support checking for errors.
  expectedHistogram: number[];
}

function runTest(options: Readonly<TestOptions>, tc: Readonly<TestCase>): void {
  let now = new Temporal.Instant(0n);

  const backend = new Backend({
    aggregationServices: new Map(
      Object.entries(options.aggregationServices).map(([url, protocol]) => [
        url,
        { protocol },
      ]),
    ),
    includeUnencryptedHistogram: true,

    maxConversionSitesPerImpression: options.maxConversionSitesPerImpression,
    maxConversionCallersPerImpression:
      options.maxConversionCallersPerImpression,
    maxCreditSize: options.maxCreditSize,
    maxLifetimeDays: options.maxLifetimeDays,
    maxLookbackDays: options.maxLookbackDays,
    maxHistogramSize: options.maxHistogramSize,
    privacyBudgetMicroEpsilons: options.privacyBudgetMicroEpsilons,
    privacyBudgetEpoch: days(options.privacyBudgetEpochDays),

    now: () => now,
    random: () => 0.5,
    earliestEpochIndex: () => 0,
  });

  for (const event of tc.events) {
    const newNow = now.add({ seconds: event.seconds });
    if (Temporal.Instant.compare(newNow, now) <= 0) {
      throw new RangeError(
        "events must have strictly increasing seconds fields",
      );
    }
    now = newNow;

    switch (event.event) {
      case "saveImpression":
        backend.saveImpression(
          event.site,
          event.intermediarySite,
          event.options,
        );
        break;
      case "measureConversion":
        const result = backend.measureConversion(
          event.site,
          event.intermediarySite,
          event.options,
        );
        assert.deepEqual(result.unencryptedHistogram, event.expectedHistogram);
        break;
    }
  }
}

void test("e2e", async (t) => {
  const promises = [];

  for await (const path of glob("./e2e-tests/*.json")) {
    const promise = t.test(path, async (t) => {
      const json = await readFile(path, { encoding: "utf8" });
      const suite = JSON.parse(json) as TestSuite;
      await Promise.all(
        suite.cases.map((tc) =>
          t.test(tc.name, () => runTest(suite.options, tc)),
        ),
      );
    });

    promises.push(promise);
  }

  await Promise.all(promises);
});
