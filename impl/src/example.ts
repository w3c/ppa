import type {
  AttributionImpressionOptions,
  AttributionConversionOptions,
} from "./index";

import * as index from "./index";

import { Frontend } from "./frontend";

const frontend = new Frontend();

function numberOrUndefined(input: HTMLInputElement): number | undefined {
  const val = input.valueAsNumber;
  return Number.isNaN(val) ? undefined : val;
}

function reportValidity(this: HTMLFormElement) {
  this.reportValidity();
}

(function () {
  const form = document.querySelector<HTMLFormElement>("#saveImpression")!;

  const histogramIndex = form.elements.namedItem(
    "histogramIndex",
  ) as HTMLInputElement;
  histogramIndex.min = "0";

  const matchValue = form.elements.namedItem("matchValue") as HTMLInputElement;
  matchValue.min = "0";
  matchValue.valueAsNumber = index.DEFAULT_IMPRESSION_MATCH_VALUE;

  const lifetimeDays = form.elements.namedItem(
    "lifetimeDays",
  ) as HTMLInputElement;
  lifetimeDays.min = "1";
  lifetimeDays.valueAsNumber = index.DEFAULT_IMPRESSION_LIFETIME_DAYS;

  const priority = form.elements.namedItem("priority") as HTMLInputElement;
  priority.valueAsNumber = index.DEFAULT_IMPRESSION_PRIORITY;

  const output = form.querySelector("ol")!;

  form.addEventListener("input", reportValidity);

  form.addEventListener("submit", function (this: HTMLFormElement, e) {
    e.preventDefault();

    if (!this.reportValidity()) {
      return;
    }

    const submitter = e.submitter as HTMLButtonElement;
    submitter.disabled = true;

    const opts: AttributionImpressionOptions = {
      histogramIndex: histogramIndex.valueAsNumber,
      lifetimeDays: numberOrUndefined(lifetimeDays),
      matchValue: numberOrUndefined(matchValue),
      priority: numberOrUndefined(priority),
    };

    void frontend
      .saveImpression(opts)
      .then(() => {
        const li = document.createElement("li");
        li.innerText = "Success";
        output.append(li);
      })
      .catch((e) => {
        const li = document.createElement("li");
        li.innerText = `Error: ${e}`;
        output.append(li);
      })
      .finally(() => (submitter.disabled = false));
  });
})();

(function () {
  const form = document.querySelector<HTMLFormElement>("#measureConversion")!;

  const histogramSize = form.elements.namedItem(
    "histogramSize",
  ) as HTMLInputElement;
  histogramSize.min = "0";

  const epsilon = form.elements.namedItem("epsilon") as HTMLInputElement;
  epsilon.min = "0.01";
  epsilon.step = "0.01";
  epsilon.max = index.MAX_CONVERSION_EPSILON.toString();
  epsilon.valueAsNumber = index.DEFAULT_CONVERSION_EPSILON;

  const value = form.elements.namedItem("value") as HTMLInputElement;
  value.min = "1";
  value.valueAsNumber = index.DEFAULT_CONVERSION_VALUE;

  const maxValue = form.elements.namedItem("maxValue") as HTMLInputElement;
  maxValue.min = "1";
  maxValue.valueAsNumber = index.DEFAULT_CONVERSION_MAX_VALUE;

  const lookbackDays = form.elements.namedItem(
    "lookbackDays",
  ) as HTMLInputElement;
  lookbackDays.min = "1";

  const credit = form.elements.namedItem("credit") as HTMLInputElement;

  const matchValues = form.elements.namedItem(
    "matchValues",
  ) as HTMLInputElement;

  const output = form.querySelector("ol")!;

  form.addEventListener("input", reportValidity);

  form.addEventListener("submit", function (this: HTMLFormElement, e) {
    e.preventDefault();

    if (!this.reportValidity()) {
      return;
    }

    const submitter = e.submitter as HTMLButtonElement;
    submitter.disabled = true;

    const opts: AttributionConversionOptions = {
      aggregationService: "",
      epsilon: numberOrUndefined(epsilon),
      histogramSize: histogramSize.valueAsNumber,
      matchValues: matchValues.value
        .trim()
        .split(/\s+/)
        .filter((v) => v.length > 0)
        .map((v) => Number.parseInt(v, 10)),
      logicOptions: {
        credit: credit.value.trim().split(/\s+/).map(Number.parseFloat),
      },
      lookbackDays: numberOrUndefined(lookbackDays),
      maxValue: numberOrUndefined(maxValue),
      value: numberOrUndefined(value),
    };

    void frontend
      .measureConversion(opts)
      .then((result) => {
        const li = document.createElement("li");

        const dl = document.createElement("dl");
        let any = false;
        for (const [i, v] of result.unencryptedHistogram!.entries()) {
          if (v === 0) {
            continue;
          }

          any = true;

          const dt = document.createElement("dt");
          dt.innerText = i.toString();

          const dd = document.createElement("dd");
          dd.innerText = v.toString();

          dl.append(dt, dd);
        }

        li.append("Histogram:", any ? dl : " all-zero");
        output.append(li);
      })
      .catch((e) => {
        const li = document.createElement("li");
        li.innerText = `Error: ${e}`;
        output.append(li);
      })
      .finally(() => (submitter.disabled = false));
  });
})();
