import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
} from "./index";

export interface AsyncCall<M extends string, T> {
  method: M;
  options: T;
  site: string;
  intermediarySite: string | undefined;
}

export type AsyncSaveImpressionCall = AsyncCall<
  "save-impression",
  AttributionImpressionOptions
>;

export type AsyncMeasureConversionCall = AsyncCall<
  "measure-conversion",
  AttributionConversionOptions
>;

// Exposed for testing only. This would be omitted in reality.
export type AsyncLogStateCall = AsyncCall<"log-state", undefined>;

export type AsyncAttributionCall =
  | AsyncSaveImpressionCall
  | AsyncMeasureConversionCall
  | AsyncLogStateCall;
