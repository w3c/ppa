import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
  AttributionProtocol,
} from "./index";

import { Backend, days } from "./backend";

import { strict as assert } from "assert";
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

function runTestSuite({ name, options, cases }: TestSuite): void {
  void test(name, async (t) => {
    await Promise.all(
      cases.map((tc) =>
        t.test(tc.name, () => {
          let now = new Temporal.Instant(0n);

          const backend = new Backend({
            aggregationServices: new Map(
              Object.entries(options.aggregationServices).map(
                ([url, protocol]) => [url, { protocol }],
              ),
            ),
            includeUnencryptedHistogram: true,

            maxConversionSitesPerImpression:
              options.maxConversionSitesPerImpression,
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
                assert.deepEqual(
                  result.unencryptedHistogram,
                  event.expectedHistogram,
                );
                break;
            }
          }
        }),
      ),
    );
  });
}

runTestSuite({
  name: "e2e",
  options: {
    aggregationServices: {
      "https://agg-service.example": "dap-15-histogram",
    },
    maxConversionSitesPerImpression: 10,
    maxConversionCallersPerImpression: 10,
    maxCreditSize: Infinity,
    maxLifetimeDays: 30,
    maxLookbackDays: 60,
    maxHistogramSize: 100,
    privacyBudgetMicroEpsilons: 1000000,
    privacyBudgetEpochDays: 7,
  },
  cases: [
    {
      name: "basic",
      events: [
        {
          seconds: 1,
          site: "publisher.example",
          event: "saveImpression",
          options: { histogramIndex: 0 },
        },
        {
          seconds: 2,
          site: "publisher.example",
          event: "saveImpression",
          options: { histogramIndex: 1 },
        },
        {
          seconds: 3,
          site: "advertiser.example",
          event: "measureConversion",
          options: {
            aggregationService: "https://agg-service.example",
            histogramSize: 3,
            value: 5,
            maxValue: 10,
          },
          expectedHistogram: [0, 5, 0],
        },
      ],
    },
    {
      name: "simulate-multiple-buckets",
      events: [
        {
          seconds: 1,
          site: "publisher.example",
          event: "saveImpression",
          // 100 will be used for campaign queries
          options: { histogramIndex: 0, matchValue: 100 },
        },
        {
          seconds: 2,
          site: "publisher.example",
          event: "saveImpression",
          // 200 will be used for geo queries
          options: { histogramIndex: 1, matchValue: 200 },
        },
        {
          seconds: 3,
          site: "publisher.example",
          event: "saveImpression",
          options: { histogramIndex: 2, matchValue: 100 },
        },
        {
          seconds: 4,
          site: "publisher.example",
          event: "saveImpression",
          options: { histogramIndex: 3, matchValue: 200 },
        },
        {
          seconds: 5,
          site: "advertiser.example",
          event: "measureConversion",
          options: {
            aggregationService: "https://agg-service.example",
            histogramSize: 4,
            matchValues: [100],
            epsilon: 0.5,
          },
          expectedHistogram: [0, 0, 1, 0],
        },
        {
          seconds: 6,
          site: "advertiser.example",
          event: "measureConversion",
          options: {
            aggregationService: "https://agg-service.example",
            histogramSize: 4,
            matchValues: [200],
            epsilon: 0.5,
          },
          expectedHistogram: [0, 0, 0, 1],
        },
      ],
    },
  ],
});
