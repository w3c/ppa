import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
  AttributionProtocol,
} from "./index";

import type { TestContext } from "node:test";

import { Backend, days } from "./backend";

import { strict as assert } from "assert";
import { glob, readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { Temporal } from "temporal-polyfill";

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
  options?: TestOptions;
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

function runTest(
  defaultOptions: Readonly<TestOptions>,
  tc: Readonly<TestCase>,
): void {
  const options = tc.options ?? defaultOptions;

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

const optionsName = "OPTIONS.json";

async function runTestsInDir(t: TestContext, dir: string): Promise<void> {
  const optionsJson = await readFile(path.join(dir, optionsName), "utf8");
  const defaultOptions = JSON.parse(optionsJson) as TestOptions;

  const promises = [];

  for await (const entry of glob(path.join(dir, "*.json"))) {
    if (path.basename(entry) === optionsName) {
      continue;
    }

    const promise = t.test(entry, async () => {
      const json = await readFile(entry, "utf8");
      const tc = JSON.parse(json) as TestCase;
      runTest(defaultOptions, tc);
    });

    promises.push(promise);
  }

  await Promise.all(promises);
}

void test("e2e", async (t) => runTestsInDir(t, "e2e-tests"));
