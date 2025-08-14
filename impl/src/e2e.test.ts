import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
  AttributionProtocol,
} from "./index";

import type { TestContext } from "node:test";

import { Backend, days } from "./backend";

import { strict as assert } from "assert";
import "fake-indexeddb/auto";
import { glob, readFile } from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { Temporal } from "temporal-polyfill";

interface TestConfig {
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
  config?: TestConfig;
  events: Event[];
}

type Event = {
  seconds: number;
  site: string;
  intermediarySite?: string | undefined;
} & (SaveImpression | MeasureConversion);

type ExpectedError =
  | "RangeError"
  | "ReferenceError"
  | {
      error: "DOMException";
      name: string;
    };

interface SaveImpression {
  event: "saveImpression";
  options: AttributionImpressionOptions;
  expectedError?: ExpectedError;
}

interface MeasureConversion {
  event: "measureConversion";
  options: AttributionConversionOptions;
  expected: number[] | ExpectedError;
}

async function assertRejects(
  promise: Promise<unknown>,
  expectedError: ExpectedError,
  seconds: number,
): Promise<void> {
  const check =
    typeof expectedError === "string"
      ? { name: expectedError }
      : (err: unknown) => {
          assert.ok(err instanceof DOMException);
          assert.equal(err.name, expectedError.name);
          return true;
        };

  await assert.rejects(promise, check, `seconds: ${seconds}`);
}

async function runTest(
  t: TestContext,
  defaultConfig: Readonly<TestConfig>,
  tc: Readonly<TestCase>,
): Promise<void> {
  const config = tc.config ?? defaultConfig;

  let now = new Temporal.Instant(0n);

  const backend = new Backend({
    aggregationServices: new Map(
      Object.entries(config.aggregationServices).map(([url, protocol]) => [
        url,
        { protocol },
      ]),
    ),
    includeUnencryptedHistogram: true,

    maxConversionSitesPerImpression: config.maxConversionSitesPerImpression,
    maxConversionCallersPerImpression: config.maxConversionCallersPerImpression,
    maxCreditSize: config.maxCreditSize,
    maxLifetimeDays: config.maxLifetimeDays,
    maxLookbackDays: config.maxLookbackDays,
    maxHistogramSize: config.maxHistogramSize,
    privacyBudgetMicroEpsilons: config.privacyBudgetMicroEpsilons,
    privacyBudgetEpoch: days(config.privacyBudgetEpochDays),

    // Give each run a separate DB name to prevent interference.
    dbName: t.fullName,

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
      case "saveImpression": {
        const promise = backend.saveImpression(
          event.site,
          event.intermediarySite,
          event.options,
        );

        if (event.expectedError === undefined) {
          await assert.doesNotReject(promise);
        } else {
          await assertRejects(promise, event.expectedError, event.seconds);
        }

        break;
      }
      case "measureConversion": {
        const promise = backend.measureConversion(
          event.site,
          event.intermediarySite,
          event.options,
        );

        if (Array.isArray(event.expected)) {
          const result = await promise;
          assert.deepEqual(
            result.unencryptedHistogram,
            event.expected,
            `seconds: ${event.seconds}`,
          );
        } else {
          await assertRejects(promise, event.expected, event.seconds);
        }

        break;
      }
    }
  }
}

const configName = "CONFIG.json";

async function runTestsInDir(t: TestContext, dir: string): Promise<void> {
  const configJson = await readFile(path.join(dir, configName), "utf8");
  const defaultConfig = JSON.parse(configJson) as TestConfig;

  const promises = [];

  for await (const entry of glob(path.join(dir, "*.json"))) {
    if (path.basename(entry) === configName) {
      continue;
    }

    const promise = t.test(entry, async (t) => {
      const json = await readFile(entry, "utf8");
      const tc = JSON.parse(json) as TestCase;
      await runTest(t, defaultConfig, tc);
    });

    promises.push(promise);
  }

  await Promise.all(promises);
}

void test("e2e", async (t) => runTestsInDir(t, "e2e-tests"));
