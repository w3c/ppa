import type { AttributionImpressionOptions } from "./index";

import type { Dictionary } from "structured-headers";

import { parseDictionary } from "structured-headers";

function parseInnerListOfSites(dict: Dictionary, key: string): string[] {
  const [values] = dict.get(key) ?? [[]];
  if (!Array.isArray(values)) {
    throw new TypeError(`${key} must be an inner list`);
  }

  const sites = [];
  for (const [i, [value]] of values.entries()) {
    if (typeof value !== "string") {
      throw new TypeError(`${key}[${i}] must be a string`);
    }
    sites.push(value);
  }
  return sites;
}

export function parseSaveImpressionHeader(
  input: string,
): AttributionImpressionOptions {
  const dict = parseDictionary(input);

  const [histogramIndex] = dict.get("histogram-index") ?? [undefined];
  if (
    typeof histogramIndex !== "number" ||
    !Number.isInteger(histogramIndex) ||
    histogramIndex < 0
  ) {
    throw new RangeError("histogram-index must be a non-negative integer");
  }

  const conversionSites = parseInnerListOfSites(dict, "conversion-sites");
  const conversionCallers = parseInnerListOfSites(dict, "conversion-callers");

  const [matchValue] = dict.get("match-value") ?? [0];
  if (
    typeof matchValue !== "number" ||
    !Number.isInteger(matchValue) ||
    matchValue < 0
  ) {
    throw new RangeError("match-value must be a non-negative integer");
  }

  const [lifetimeDays] = dict.get("lifetime-days") ?? [30];
  if (
    typeof lifetimeDays !== "number" ||
    !Number.isInteger(lifetimeDays) ||
    lifetimeDays <= 0
  ) {
    throw new RangeError("lifetime-days must be a positive integer");
  }

  const [priority] = dict.get("priority") ?? [0];
  if (typeof priority !== "number" || !Number.isInteger(priority)) {
    throw new RangeError("priority must be an integer");
  }

  return {
    histogramIndex,
    matchValue,
    conversionSites,
    conversionCallers,
    lifetimeDays,
    priority,
  };
}
