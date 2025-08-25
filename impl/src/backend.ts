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

import * as idb from "idb";

import "temporal-polyfill/global";

import * as psl from "psl";

// TODO(https://github.com/fullcalendar/temporal-polyfill/issues/77): Use
// Temporal.Instant for timestamp and Temporal.Duration for lifetime.
interface Impression {
  matchValue: number;
  impressionSite: string;
  intermediarySite: string | undefined;
  conversionSites: Set<string>;
  conversionCallers: Set<string>;
  timestamp: Date;
  lifetimeDays: number;
  histogramIndex: number;
  priority: number;
}

type PrivacyBudgetKey = [site: string, epoch: number];

interface PrivacyBudgetEntry {
  key: PrivacyBudgetKey;
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
  credit: readonly number[];
}

export function days(days: number): Temporal.Duration {
  // We use `hours: X` here instead of `days` because days are considered to be
  // "calendar" units, making them incapable of being used in calculations
  // without a reference point.
  return Temporal.Duration.from({ hours: days * 24 });
}

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
  readonly privacyBudgetEpoch: Temporal.Duration;

  readonly dbName: string;

  now(): Temporal.Instant;
  random(): number;
  earliestEpochIndex(site: string): number;
}

function allZeroHistogram(size: number): number[] {
  return new Array<number>(size).fill(0);
}

interface EpochStart {
  site: string;
  start: Date;
}

interface AttributionDB extends idb.DBSchema {
  impressions: { key: number; value: Impression };
  epochStarts: { key: string; value: EpochStart };
  privacyBudgets: { key: PrivacyBudgetKey; value: PrivacyBudgetEntry };
  lastBrowsingHistoryClear: { key: string; value: Date };
}

type FullTransaction = idb.IDBPTransaction<
  AttributionDB,
  ["impressions", "epochStarts", "privacyBudgets", "lastBrowsingHistoryClear"],
  "readwrite"
>;

export class Backend {
  enabled: boolean = true;

  readonly #delegate: Delegate;

  #db: idb.IDBPDatabase<AttributionDB> | null = null;

  constructor(delegate: Delegate) {
    this.#delegate = delegate;
  }

  async #getOrCreateDB(): Promise<idb.IDBPDatabase<AttributionDB>> {
    if (this.#db !== null) {
      return this.#db;
    }

    this.#db = await idb.openDB<AttributionDB>(this.#delegate.dbName, 1, {
      upgrade(db) {
        db.createObjectStore("impressions", { autoIncrement: true });
        db.createObjectStore("epochStarts", { keyPath: "site" });
        db.createObjectStore("privacyBudgets", { keyPath: "key" });
        // Singleton.
        db.createObjectStore("lastBrowsingHistoryClear", { keyPath: "" });
      },
    });

    return this.#db;
  }

  async *epochStarts(): AsyncIterableIterator<EpochStart> {
    const db = await this.#getOrCreateDB();
    for await (const cursor of db.transaction("epochStarts").store) {
      yield cursor.value;
    }
  }

  async *privacyBudgetEntries(): AsyncIterableIterator<PrivacyBudgetEntry> {
    const db = await this.#getOrCreateDB();
    for await (const cursor of db.transaction("privacyBudgets").store) {
      yield cursor.value;
    }
  }

  async *impressions(): AsyncIterableIterator<Impression> {
    const db = await this.#getOrCreateDB();
    for await (const cursor of db.transaction("impressions").store) {
      yield cursor.value;
    }
  }

  get aggregationServices(): AttributionAggregationServices {
    return this.#delegate.aggregationServices;
  }

  async saveImpression(
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
  ): Promise<AttributionImpressionResult> {
    impressionSite = parseSite(impressionSite);

    if (intermediarySite !== undefined) {
      intermediarySite = parseSite(intermediarySite);
    }

    const timestamp = this.#delegate.now();

    if (
      histogramIndex < 0 ||
      histogramIndex >= this.#delegate.maxHistogramSize ||
      !Number.isInteger(histogramIndex)
    ) {
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

    if (!Number.isInteger(priority)) {
      throw new RangeError("priority must be an integer");
    }

    if (!this.enabled) {
      return {};
    }

    // A real implementation would not await persistence of the impression, in
    // order to reduce the ability of the caller to determine whether the API
    // was enabled. We await it here so that errors are propagated to the
    // caller.
    const db = await this.#getOrCreateDB();
    await db.add("impressions", {
      matchValue,
      impressionSite,
      intermediarySite,
      conversionSites: parsedConversionSites,
      conversionCallers: parsedConversionCallers,
      timestamp: new Date(timestamp.epochMilliseconds),
      lifetimeDays,
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

    if (epsilon <= 0 || epsilon > index.MAX_CONVERSION_EPSILON) {
      throw new RangeError(
        `epsilon must be in the range (0, ${index.MAX_CONVERSION_EPSILON}]`,
      );
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

  async measureConversion(
    topLevelSite: string,
    intermediarySite: string | undefined,
    options: AttributionConversionOptions,
  ): Promise<AttributionConversionResult> {
    topLevelSite = parseSite(topLevelSite);

    if (intermediarySite !== undefined) {
      intermediarySite = parseSite(intermediarySite);
    }

    const now = this.#delegate.now();

    const validatedOptions = this.#validateConversionOptions(options);

    const report = this.enabled
      ? await this.#doAttributionAndFillHistogram(
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

  async #commonMatchingLogic(
    txn: FullTransaction,
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
  ): Promise<Set<Impression>> {
    const matching = new Set<Impression>();

    for await (const cursor of txn.objectStore("impressions").iterate()) {
      const impression = cursor.value;
      const timestamp = impression.timestamp.toTemporalInstant();

      const impressionEpoch = await this.#getCurrentEpoch(
        txn,
        topLevelSite,
        timestamp,
      );
      if (impressionEpoch !== epoch) {
        continue;
      }
      if (
        Temporal.Instant.compare(
          now,
          timestamp.add(days(impression.lifetimeDays)),
        ) > 0
      ) {
        continue;
      }
      if (Temporal.Instant.compare(now, timestamp.add(lookback)) > 0) {
        continue;
      }
      if (
        impression.conversionSites.size > 0 &&
        !impression.conversionSites.has(topLevelSite)
      ) {
        continue;
      }
      const conversionCaller = intermediarySite ?? topLevelSite;
      if (
        impression.conversionCallers.size > 0 &&
        !impression.conversionCallers.has(conversionCaller)
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
      const impressionCaller =
        impression.intermediarySite ?? impression.impressionSite;
      if (
        impressionCallers.size > 0 &&
        !impressionCallers.has(impressionCaller)
      ) {
        continue;
      }
      matching.add(impression);
    }

    return matching;
  }

  async #doAttributionAndFillHistogram(
    topLevelSite: string,
    intermediarySite: string | undefined,
    now: Temporal.Instant,
    options: ValidatedConversionOptions,
  ): Promise<number[]> {
    const db = await this.#getOrCreateDB();
    const txn = db.transaction(
      [
        "impressions",
        "epochStarts",
        "privacyBudgets",
        "lastBrowsingHistoryClear",
      ],
      "readwrite",
    );

    let matchedImpressions;
    const currentEpoch = await this.#getCurrentEpoch(txn, topLevelSite, now);
    const startEpoch = await this.#getStartEpoch(txn, topLevelSite);
    const earliestEpoch = await this.#getCurrentEpoch(
      txn,
      topLevelSite,
      now.subtract(options.lookback),
    );
    const singleEpoch = currentEpoch === earliestEpoch;

    if (singleEpoch) {
      matchedImpressions = await this.#commonMatchingLogic(
        txn,
        topLevelSite,
        intermediarySite,
        currentEpoch,
        now,
        options,
      );
    } else {
      matchedImpressions = new Set<Impression>();
      for (let epoch = startEpoch; epoch <= currentEpoch; ++epoch) {
        const impressions = await this.#commonMatchingLogic(
          txn,
          topLevelSite,
          intermediarySite,
          epoch,
          now,
          options,
        );

        if (impressions.size > 0) {
          const key: PrivacyBudgetKey = [topLevelSite, epoch];
          const budgetOk = await this.#deductPrivacyBudget(
            txn,
            key,
            options.epsilon,
            options.value,
            options.maxValue,
            /*attributedValueForSingleEpochOpt=*/ null,
          );
          if (budgetOk) {
            for (const i of impressions) {
              matchedImpressions.add(i);
            }
          }
        }
      }
    }

    if (matchedImpressions.size === 0) {
      return allZeroHistogram(options.histogramSize);
    }

    let histogram;
    switch (options.logic) {
      case "last-n-touch":
        histogram = this.#fillHistogramWithLastNTouchAttribution(
          matchedImpressions,
          options.histogramSize,
          options.value,
          options.logicOptions.credit,
        );
        break;
    }

    if (singleEpoch) {
      const l1Norm = histogram.reduce((a, b) => a + b);
      if (l1Norm > options.value) {
        throw new DOMException(
          "l1Norm must be less than or equal to options.value",
          "InvalidStateError",
        );
      }

      const key: PrivacyBudgetKey = [topLevelSite, currentEpoch];

      const budgetOk = await this.#deductPrivacyBudget(
        txn,
        key,
        options.epsilon,
        options.value,
        options.maxValue,
        l1Norm,
      );

      if (!budgetOk) {
        histogram = allZeroHistogram(options.histogramSize);
      }
    }

    return histogram;
  }

  async #deductPrivacyBudget(
    txn: FullTransaction,
    key: PrivacyBudgetKey,
    epsilon: number,
    value: number,
    maxValue: number,
    attributedValueForSingleEpochOpt: number | null,
  ): Promise<boolean> {
    const privacyBudgets = txn.objectStore("privacyBudgets");
    let entry = await privacyBudgets.get(key);
    if (entry === undefined) {
      entry = {
        key,
        value: this.#delegate.privacyBudgetMicroEpsilons + 1000,
      };
      await privacyBudgets.put(entry);
    }
    const singleEpochQuery = attributedValueForSingleEpochOpt !== null;
    const halfReportGlobalSensitivity = singleEpochQuery
      ? attributedValueForSingleEpochOpt / 2
      : value;
    const noiseScale = (2 * maxValue) / epsilon;
    const deductionFp = halfReportGlobalSensitivity / noiseScale;
    if (deductionFp < 0 || deductionFp > index.MAX_CONVERSION_EPSILON) {
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
    credit: readonly number[],
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
        return (
          b.timestamp[Symbol.toPrimitive]("number") -
          a.timestamp[Symbol.toPrimitive]("number")
        );
      },
    );

    const N = Math.min(credit.length, sortedImpressions.length);

    const lastNImpressions = sortedImpressions.slice(0, N);

    const normalizedCredit = fairlyAllocateCredit(credit, value, () =>
      this.#delegate.random(),
    );

    const histogram = allZeroHistogram(histogramSize);

    for (const [i, impression] of lastNImpressions.entries()) {
      const value = normalizedCredit[i];
      const index = impression.histogramIndex;
      if (index < histogram.length) {
        histogram[index]! += value!;
      }
    }
    return histogram;
  }

  #encryptReport(report: readonly number[]): Uint8Array {
    void report;
    return new Uint8Array(0); // TODO
  }

  async #getCurrentEpoch(
    txn: FullTransaction,
    site: string,
    t: Temporal.Instant,
  ): Promise<number> {
    const epochStarts = txn.objectStore("epochStarts");

    const period = this.#delegate.privacyBudgetEpoch.total("seconds");
    let start = (await epochStarts.get(site))?.start;
    if (start === undefined) {
      const p = checkRandom(this.#delegate.random());
      const dur = Temporal.Duration.from({
        seconds: p * period,
      });
      start = new Date(t.subtract(dur).epochMilliseconds);
      await epochStarts.put({ site, start });
    }
    const elapsed =
      t.since(start.toTemporalInstant()).total("seconds") / period;
    return Math.floor(elapsed);
  }

  async #getStartEpoch(txn: FullTransaction, site: string): Promise<number> {
    const startEpoch = this.#delegate.earliestEpochIndex(site);
    const lastBrowsingHistoryClear = await txn
      .objectStore("lastBrowsingHistoryClear")
      .get("");
    if (lastBrowsingHistoryClear !== undefined) {
      let clearEpoch = await this.#getCurrentEpoch(
        txn,
        site,
        lastBrowsingHistoryClear.toTemporalInstant(),
      );
      clearEpoch += 2;
      if (clearEpoch > startEpoch) {
        return clearEpoch;
      }
    }
    return startEpoch;
  }

  async clearImpressionsForConversionSite(site: string): Promise<void> {
    const db = await this.#getOrCreateDB();
    const txn = db.transaction("impressions", "readwrite");

    for await (const cursor of txn.store) {
      const i = cursor.value;

      if (i.intermediarySite === site) {
        await cursor.delete();
        continue;
      }
      if (!i.conversionSites.has(site)) {
        continue;
      }
      if (i.conversionSites.size > 1) {
        i.conversionSites.delete(site);
        await cursor.update(i);
        continue;
      }
      await cursor.delete();
    }
  }

  async clearExpiredImpressions(): Promise<void> {
    const db = await this.#getOrCreateDB();
    const txn = db.transaction("impressions", "readwrite");

    const now = this.#delegate.now();

    for await (const cursor of txn.store.iterate()) {
      const i = cursor.value;
      const expiry = i.timestamp.toTemporalInstant().add(days(i.lifetimeDays));

      if (Temporal.Instant.compare(now, expiry) > 0) {
        await cursor.delete();
      }
    }
  }
}

function checkRandom(p: number): number {
  if (!(p >= 0 && p < 1)) {
    throw new RangeError("random must be in the range [0, 1)");
  }
  return p;
}

export function fairlyAllocateCredit(
  credit: readonly number[],
  value: number,
  rand: () => number,
): number[] {
  // TODO: replace with precise sum
  const sumCredit = credit.reduce((a, b) => a + b, 0);

  const roundedCredit = credit.map((item) => (value * item) / sumCredit);

  let idx1 = 0;

  for (let n = 1; n < roundedCredit.length; ++n) {
    let idx2 = n;

    const frac1 = roundedCredit[idx1]! - Math.floor(roundedCredit[idx1]!);
    const frac2 = roundedCredit[idx2]! - Math.floor(roundedCredit[idx2]!);
    if (frac1 === 0 && frac2 === 0) {
      continue;
    }

    const [incr1, incr2] =
      frac1 + frac2 > 1 ? [1 - frac1, 1 - frac2] : [-frac1, -frac2];

    const p1 = incr2 / (incr1 + incr2);

    const r = checkRandom(rand());

    let incr;
    if (r < p1) {
      incr = incr1;
      [idx1, idx2] = [idx2, idx1];
    } else {
      incr = incr2;
    }

    roundedCredit[idx2]! += incr;
    roundedCredit[idx1]! -= incr;
  }

  return roundedCredit.map((item) => Math.round(item));
}
