import { Backend } from "./backend";

import type { AsyncAttributionCall } from "./protocol";

import { Temporal } from "temporal-polyfill";

const backend = new Backend({
  aggregationServices: new Map([["", { protocol: "dap-15-histogram" }]]),
  includeUnencryptedHistogram: true,

  maxConversionSitesPerImpression: 10,
  maxConversionCallersPerImpression: 10,
  maxCreditSize: Infinity,
  maxLifetimeDays: 30,
  maxLookbackDays: 60,
  maxHistogramSize: 100,
  privacyBudgetMicroEpsilons: 1000000,

  now: Temporal.Now.instant,
  random: () => 0.5,
});

onmessage = (e: MessageEvent<AsyncAttributionCall>) => {
  let result;

  try {
    switch (e.data.method) {
      case "save-impression":
        result = backend.saveImpression(e.data.site, e.data.options);
        break;
      case "measure-conversion":
        result = backend.measureConversion(
          e.data.site,
          e.data.intermediarySite,
          e.data.options,
        );
        break;
      case "log-state":
        result = backend.logState();
        break;
      default:
        result = new RangeError("unknown method");
        break;
    }
  } catch (error) {
    result = error;
  }

  e.ports[0]?.postMessage(result);
};
