import type {
  AttributionAggregationService,
  AttributionAggregationServices,
  AttributionConversionOptions,
  AttributionConversionResult,
  AttributionImpressionOptions,
  AttributionImpressionResult,
  AttributionLogic,
} from "./index";

import * as index from "./index";

import { Temporal } from "temporal-polyfill";

import * as psl from "psl";

interface Impression {
  matchValue: number;
  impressionSite: string;
  intermediarySite: string | undefined;
  conversionSites: Set<string>;
  conversionCallers: Set<string>;
  timestamp: Temporal.Instant;
  lifetime: Temporal.Duration;
  histogramIndex: number;
  priority: number;
}

interface PrivacyBudgetKey {
  epoch: number;
  site: string;
}

interface PrivacyBudgetStoreEntry extends Readonly<PrivacyBudgetKey> {
  value: number;
}

interface ValidatedConversionOptions {
  aggregationService: Readonly<AttributionAggregationService>;
  epsilon: number;
  histogramSize: number;
  lookback: Temporal.Duration;
  matchValues: Set<number>;
  impressionSites: Set<string>;
  impressionCallers: Set<string>;
  logic: AttributionLogic;
  logicOptions: ValidatedLogicOptions;
  value: number;
  maxValue: number;
}

interface ValidatedLogicOptions {
  credit: number[];
}

function days(days: number): Temporal.Duration {
  // We use `hours: X` here instead of `days` because days are considered to be
  // "calendar" units, making them incapable of being used in calculations
  // without a reference point.
  return Temporal.Duration.from({ hours: days * 24 });
}

const PRIVACY_BUDGET_EPOCH = days(7);

// TODO: This value is not a constant epoch index. A value is chosen for each
// site based on user agent preferences or configuration.
const EARLIEST_EPOCH_INDEX = 0;

function parseSite(input: string): string {
  const site = psl.get(input);
  if (site === null) {
    throw new DOMException(`invalid site ${input}`, "SyntaxError");
  }
  return site;
}

export interface Delegate {
  readonly aggregationServices: AttributionAggregationServices;
  readonly includeUnencryptedHistogram?: boolean;

  readonly maxConversionSitesPerImpression: number;
  readonly maxConversionCallersPerImpression: number;
  readonly maxCreditSize: number;
  readonly maxLifetimeDays: number;
  readonly maxLookbackDays: number;
  readonly maxHistogramSize: number;
  readonly privacyBudgetMicroEpsilons: number;

  now(): Temporal.Instant;
  random(): number;
}

function allZeroHistogram(size: number): number[] {
  return new Array<number>(size).fill(0);
}

export class Backend {
  enabled: boolean = true;

  readonly #delegate: Delegate;
  #impressions: Readonly<Impression>[] = [];
  readonly #epochStartStore: Map<string, Temporal.Instant> = new Map();
  readonly #privacyBudgetStore: PrivacyBudgetStoreEntry[] = [];

  #lastBrowsingHistoryClear: Temporal.Instant | null = null;

  constructor(delegate: Delegate) {
    this.#delegate = delegate;
  }

  get epochStarts(): Iterable<[string, Temporal.Instant]> {
    return this.#epochStartStore.entries();
  }

  get privacyBudgetEntries(): Iterable<Readonly<PrivacyBudgetStoreEntry>> {
    return this.#privacyBudgetStore;
  }

  get aggregationServices(): AttributionAggregationServices {
    return this.#delegate.aggregationServices;
  }

  saveImpression(
    impressionSite: string,
    intermediarySite: string | undefined,
    {
      histogramIndex,
      matchValue = index.DEFAULT_IMPRESSION_MATCH_VALUE,
      conversionSites = [],
      conversionCallers = [],
      lifetimeDays = index.DEFAULT_IMPRESSION_LIFETIME_DAYS,
      priority = index.DEFAULT_IMPRESSION_PRIORITY,
    }: AttributionImpressionOptions,
  ): AttributionImpressionResult {
    const timestamp = this.#delegate.now();

    if (histogramIndex < 0 || !Number.isInteger(histogramIndex)) {
      throw new RangeError("histogramIndex must be a non-negative integer");
    }

    if (lifetimeDays <= 0 || !Number.isInteger(lifetimeDays)) {
      throw new RangeError("lifetimeDays must be a positive integer");
    }
    lifetimeDays = Math.min(lifetimeDays, this.#delegate.maxLifetimeDays);

    const maxConversionSitesPerImpression =
      this.#delegate.maxConversionSitesPerImpression;
    if (conversionSites.length > maxConversionSitesPerImpression) {
      throw new RangeError(
        `conversionSites.length must be <= ${maxConversionSitesPerImpression}`,
      );
    }
    const parsedConversionSites = new Set<string>();
    for (const site of conversionSites) {
      parsedConversionSites.add(parseSite(site));
    }

    const maxConversionCallersPerImpression =
      this.#delegate.maxConversionCallersPerImpression;
    if (conversionCallers.length > maxConversionCallersPerImpression) {
      throw new RangeError(
        `conversionCallers.length must be <= ${maxConversionCallersPerImpression}`,
      );
    }
    const parsedConversionCallers = new Set<string>();
    for (const site of conversionCallers) {
      parsedConversionCallers.add(parseSite(site));
    }

    if (matchValue < 0 || !Number.isInteger(matchValue)) {
      throw new RangeError("matchValue must be a non-negative integer");
    }

    if (!this.enabled) {
      return {};
    }

    this.#impressions.push({
      matchValue,
      impressionSite,
      intermediarySite,
      conversionSites: parsedConversionSites,
      conversionCallers: parsedConversionCallers,
      timestamp,
      lifetime: days(lifetimeDays),
      histogramIndex,
      priority,
    });

    return {};
  }

  #validateConversionOptions({
    aggregationService,
    epsilon = index.DEFAULT_CONVERSION_EPSILON,
    histogramSize,
    impressionSites = [],
    impressionCallers = [],
    lookbackDays = this.#delegate.maxLookbackDays,
    logic = index.DEFAULT_CONVERSION_LOGIC,
    logicOptions,
    maxValue = index.DEFAULT_CONVERSION_MAX_VALUE,
    matchValues = [],
    value = index.DEFAULT_CONVERSION_VALUE,
  }: AttributionConversionOptions): ValidatedConversionOptions {
    const aggregationServiceEntry =
      this.aggregationServices.get(aggregationService);
    if (aggregationServiceEntry === undefined) {
      throw new ReferenceError("unknown aggregation service");
    }

    if (epsilon <= 0 || epsilon > 4294) {
      throw new RangeError("epsilon must be in the range (0, 4294]");
    }

    const maxHistogramSize = this.#delegate.maxHistogramSize;
    if (
      histogramSize < 1 ||
      histogramSize > maxHistogramSize ||
      !Number.isInteger(histogramSize)
    ) {
      throw new RangeError(
        `histogramSize must be an integer in the range [1, ${maxHistogramSize}]`,
      );
    }

    let credit = [1];

    switch (logic) {
      case "last-n-touch":
        if (value <= 0 || !Number.isInteger(value)) {
          throw new RangeError("value must be a positive integer");
        }
        if (maxValue <= 0 || !Number.isInteger(value)) {
          throw new RangeError("maxValue must be a positive integer");
        }
        if (value > maxValue) {
          throw new RangeError("value must be <= maxValue");
        }
        if (logicOptions?.credit) {
          credit = logicOptions.credit;
          const maxCreditSize = this.#delegate.maxCreditSize;
          if (credit.length === 0 || credit.length > maxCreditSize) {
            throw new RangeError(
              `credit size must be in the range [1, ${maxCreditSize}]`,
            );
          }
          for (const c of credit) {
            if (c <= 0 || !Number.isFinite(value)) {
              throw new RangeError("credit must be positive and finite");
            }
          }
        }

        break;
      default:
        throw new RangeError("unknown logic");
    }

    if (lookbackDays <= 0 || !Number.isInteger(lookbackDays)) {
      throw new RangeError("lookbackDays must be a positive integer");
    }

    const matchValueSet = new Set<number>();
    for (const value of matchValues) {
      if (value < 0 || !Number.isInteger(value)) {
        throw new RangeError("match value must be a non-negative integer");
      }
      matchValueSet.add(value);
    }

    const parsedImpressionSites = new Set<string>();
    for (const site of impressionSites) {
      parsedImpressionSites.add(parseSite(site));
    }

    const parsedImpressionCallers = new Set<string>();
    for (const site of impressionCallers) {
      parsedImpressionCallers.add(parseSite(site));
    }

    return {
      aggregationService: aggregationServiceEntry,
      epsilon,
      histogramSize,
      lookback: days(lookbackDays),
      matchValues: matchValueSet,
      impressionSites: parsedImpressionSites,
      impressionCallers: parsedImpressionCallers,
      logic,
      logicOptions: { credit },
      value,
      maxValue,
    };
  }

  measureConversion(
    topLevelSite: string,
    intermediarySite: string | undefined,
    options: AttributionConversionOptions,
  ): AttributionConversionResult {
    const now = this.#delegate.now();

    const validatedOptions = this.#validateConversionOptions(options);

    const report = this.enabled
      ? this.#doAttributionAndFillHistogram(
          topLevelSite,
          intermediarySite,
          now,
          validatedOptions,
        )
      : allZeroHistogram(validatedOptions.histogramSize);

    const result: AttributionConversionResult = {
      report: this.#encryptReport(report),
    };
    if (this.#delegate.includeUnencryptedHistogram) {
      result.unencryptedHistogram = report;
    }
    return result;
  }

  #commonMatchingLogic(
    topLevelSite: string,
    intermediarySite: string | undefined,
    epoch: number,
    now: Temporal.Instant,
    {
      lookback,
      impressionSites,
      impressionCallers,
      matchValues,
    }: ValidatedConversionOptions,
  ): Set<Impression> {
    const matching = new Set<Impression>();

    const earliestEpoch = this.#getCurrentEpoch(
      topLevelSite,
      now.subtract(lookback),
    );
    if (earliestEpoch > epoch) {
      return matching;
    }

    for (const impression of this.#impressions) {
      const impressionEpoch = this.#getCurrentEpoch(
        topLevelSite,
        impression.timestamp,
      );
      if (impressionEpoch !== epoch) {
        continue;
      }
      if (
        Temporal.Instant.compare(
          now,
          impression.timestamp.add(impression.lifetime),
        ) > 0
      ) {
        continue;
      }
      if (
        Temporal.Instant.compare(now, impression.timestamp.add(lookback)) > 0
      ) {
        continue;
      }
      if (
        impression.conversionSites.size > 0 &&
        !impression.conversionSites.has(topLevelSite)
      ) {
        continue;
      }
      let caller = intermediarySite ?? topLevelSite;
      if (
        impression.conversionCallers.size > 0 &&
        !impression.conversionCallers.has(caller)
      ) {
        continue;
      }
      if (matchValues.size > 0 && !matchValues.has(impression.matchValue)) {
        continue;
      }
      if (
        impressionSites.size > 0 &&
        !impressionSites.has(impression.impressionSite)
      ) {
        continue;
      }
      // TODO: The wording from Step 4.10 of
      // https://w3c.github.io/ppa/#common-matching-logic is a bit ambiguous.
      caller = impression.intermediarySite ?? impression.impressionSite;
      if (impressionCallers.size > 0 && !impressionCallers.has(caller)) {
        continue;
      }
      matching.add(impression);
    }

    return matching;
  }

  #doAttributionAndFillHistogram(
    topLevelSite: string,
    intermediarySite: string | undefined,
    now: Temporal.Instant,
    options: ValidatedConversionOptions,
  ): number[] {
    const matchedImpressions = new Set<Impression>();
    const currentEpoch = this.#getCurrentEpoch(topLevelSite, now);
    const startEpoch = this.#getStartEpoch(topLevelSite);
    for (let epoch = startEpoch; epoch <= currentEpoch; ++epoch) {
      const impressions = this.#commonMatchingLogic(
        topLevelSite,
        intermediarySite,
        epoch,
        now,
        options,
      );
      if (impressions.size > 0) {
        const key = { epoch, site: topLevelSite };
        const budgetOk = this.#deductPrivacyBudget(
          key,
          options.epsilon,
          options.value,
          options.maxValue,
        );
        if (budgetOk) {
          for (const i of impressions) {
            matchedImpressions.add(i);
          }
        }
      }
    }
    if (matchedImpressions.size === 0) {
      return allZeroHistogram(options.histogramSize);
    }
    switch (options.logic) {
      case "last-n-touch":
        return this.#fillHistogramWithLastNTouchAttribution(
          matchedImpressions,
          options.histogramSize,
          options.value,
          options.logicOptions.credit,
        );
    }
  }

  #deductPrivacyBudget(
    key: PrivacyBudgetKey,
    epsilon: number,
    sensitivity: number,
    globalSensitivity: number,
  ): boolean {
    let entry = this.#privacyBudgetStore.find(
      (e) => e.epoch === key.epoch && e.site === key.site,
    );
    if (entry === undefined) {
      entry = {
        value: this.#delegate.privacyBudgetMicroEpsilons + 1000,
        ...key,
      };
      this.#privacyBudgetStore.push(entry);
    }
    const deductionFp = (epsilon * sensitivity) / globalSensitivity;
    if (deductionFp < 0 || deductionFp > 4294) {
      entry.value = 0;
      return false;
    }
    const deduction = Math.ceil(deductionFp * 1000000);
    if (deduction > entry.value) {
      entry.value = 0;
      return false;
    }
    entry.value -= deduction;
    return true;
  }

  #fillHistogramWithLastNTouchAttribution(
    matchedImpressions: Set<Impression>,
    histogramSize: number,
    value: number,
    credit: number[],
  ): number[] {
    if (matchedImpressions.size === 0) {
      throw new DOMException(
        "matchedImpressions must not be empty",
        "InvalidStateError",
      );
    }

    const sortedImpressions = Array.from(matchedImpressions).toSorted(
      (a, b) => {
        if (a.priority < b.priority) {
          return -1;
        }
        if (a.priority > b.priority) {
          return 1;
        }
        return Temporal.Instant.compare(b.timestamp, a.timestamp);
      },
    );

    const N = Math.min(credit.length, sortedImpressions.length);

    const lastNImpressions = sortedImpressions.slice(0, N);

    const normalizedCredit = fairlyAllocateCredit(credit, value);

    const histogram = allZeroHistogram(histogramSize);

    for (let i = 0; i < lastNImpressions.length; ++i) {
      const impression = lastNImpressions[i]!;
      const value = normalizedCredit[i];
      const index = impression.histogramIndex;
      if (index < histogram.length) {
        histogram[index]! += value!;
      }
    }
    return histogram;
  }

  #encryptReport(report: number[]): Uint8Array {
    void report;
    return new Uint8Array(0); // TODO
  }

  #getCurrentEpoch(site: string, t: Temporal.Instant): number {
    const period = PRIVACY_BUDGET_EPOCH.total("seconds");
    let start = this.#epochStartStore.get(site);
    if (start === undefined) {
      const p = this.#delegate.random();
      if (!(p >= 0 && p < 1)) {
        throw new RangeError("random must be in the range [0, 1)");
      }
      const dur = Temporal.Duration.from({
        seconds: p * period,
      });
      start = t.subtract(dur);
      this.#epochStartStore.set(site, start);
    }
    const elapsed = t.since(start).total("seconds") / period;
    return Math.floor(elapsed);
  }

  #getStartEpoch(site: string): number {
    const startEpoch = EARLIEST_EPOCH_INDEX;
    if (this.#lastBrowsingHistoryClear) {
      let clearEpoch = this.#getCurrentEpoch(
        site,
        this.#lastBrowsingHistoryClear,
      );
      clearEpoch += 2;
      if (clearEpoch > startEpoch) {
        return clearEpoch;
      }
    }
    return startEpoch;
  }

  clearImpressionsForConversionSite(site: string): void {
    this.#impressions = this.#impressions.filter((impression) => {
      return (
        impression.intermediarySite !== site ||
        !impression.conversionSites.delete(site) ||
        impression.conversionSites.size > 0
      );
    });
  }

  clearDataForUser(): void {
    this.#lastBrowsingHistoryClear = this.#delegate.now();
  }
}

function fairlyAllocateCredit(credit: number[], value: number): number[] {
  const sumCredit = credit.reduce((a, b) => a + b, 0);

  const rawNormalizedCredit = credit.map((c) => (c * value) / sumCredit);

  const normalizedCredit = rawNormalizedCredit.map((c) => Math.ceil(c));

  const shuffledFractionalIndices = shuffleArray(
    credit
      .map((_, i) => i)
      .filter((i) => !Number.isInteger(rawNormalizedCredit[i])),
  );

  for (const index of shuffledFractionalIndices) {
    if (normalizedCredit.reduce((a, b) => a + b, 0) === value) {
      break;
    }
    normalizedCredit[index]! -= 1;
  }
  return normalizedCredit;
}

function shuffleArray<T>(array: T[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}
