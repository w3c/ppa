export type AttributionProtocol = "dap-15-histogram" | "tee-00";

export interface AttributionAggregationService {
  protocol: AttributionProtocol;
}

export type AttributionAggregationServices = ReadonlyMap<
  string,
  Readonly<AttributionAggregationService>
>;

export const DEFAULT_IMPRESSION_LIFETIME_DAYS = 30;
export const DEFAULT_IMPRESSION_MATCH_VALUE = 0;
export const DEFAULT_IMPRESSION_PRIORITY = 0;

export interface AttributionImpressionOptions {
  histogramIndex: number;
  matchValue?: number; // = DEFAULT_IMPRESSION_PRIORITY
  conversionSites?: string[]; // = []
  conversionCallers?: string[]; // = []
  lifetimeDays?: number; // = DEFAULT_IMPRESSION_LIFETIME_DAYS
  priority?: number; // = DEFAULT_IMPRESSION_PRIORITY
}

export type AttributionImpressionResult = object;

export type AttributionLogic = "last-n-touch";

export interface AttributionLogicOptions {
  credit?: number[];
}

export const DEFAULT_CONVERSION_EPSILON = 1.0;
export const DEFAULT_CONVERSION_LOGIC = "last-n-touch";
export const DEFAULT_CONVERSION_VALUE = 1;
export const DEFAULT_CONVERSION_MAX_VALUE = 1;

export interface AttributionConversionOptions {
  aggregationService: string;
  epsilon?: number; // = DEFAULT_CONVERSION_EPSILON

  histogramSize: number;

  lookbackDays?: number;
  matchValue?: number[]; // = []
  impressionSites?: string[]; // = []
  impressionCallers?: string[]; // = []

  logic?: AttributionLogic; // = DEFAULT_CONVERSION_LOGIC
  logicOptions?: AttributionLogicOptions;
  value?: number; // = DEFAULT_CONVERSION_VALUE
  maxValue?: number; // = DEFAULT_CONVERSION_MAX_VALUE
}

export interface AttributionConversionResult {
  report: Uint8Array;

  // Added to facilitate testing and local debugging. Will be absent in "real"
  // API usage.
  unencryptedHistogram?: number[];
}

export interface Attribution {
  readonly aggregationServices: AttributionAggregationServices;

  saveImpression(
    options: AttributionImpressionOptions,
  ): Promise<AttributionImpressionResult>;

  measureConversion(
    options: AttributionConversionOptions,
  ): Promise<AttributionConversionResult>;
}
