import type {
  Attribution,
  AttributionAggregationServices,
  AttributionConversionOptions,
  AttributionConversionResult,
  AttributionImpressionOptions,
  AttributionImpressionResult,
} from "./index";

import type { AsyncAttributionCall } from "./protocol";

import * as psl from "psl";

export class Frontend implements Attribution {
  readonly #worker: Worker;

  constructor() {
    this.#worker = new Worker("./dist/worker.js");
  }

  get aggregationServices(): AttributionAggregationServices {
    return new Map(); // TODO
  }

  #getSite(origin: string | undefined): string {
    const url = new URL(origin ?? "");
    // TODO: https://github.com/lupomontero/psl/issues/29
    const site = psl.get(url.hostname);
    if (site === null) {
      throw new DOMException("could not derive site", "NotAllowedError");
    }
    return `${url.protocol}//${site}`;
  }

  #doAsync<R>(
    call: Omit<AsyncAttributionCall, "site" | "intermediarySite">,
  ): Promise<R> {
    const site = this.#getSite(top?.origin);

    let intermediarySite: string | undefined = this.#getSite(window?.origin);
    if (intermediarySite === site) {
      intermediarySite = undefined;
    }

    const { port1, port2 } = new MessageChannel();

    const { promise, resolve, reject } = Promise.withResolvers<R>();

    port1.onmessage = (e: MessageEvent<R | Error>) => {
      if (e.data instanceof Error) {
        reject(e.data);
      } else {
        resolve(e.data);
      }
    };

    this.#worker.postMessage({ site, intermediarySite, ...call }, [port2]);
    return promise;
  }

  saveImpression(
    options: AttributionImpressionOptions,
  ): Promise<AttributionImpressionResult> {
    return this.#doAsync({
      method: "save-impression",
      options,
    });
  }

  measureConversion(
    options: AttributionConversionOptions,
  ): Promise<AttributionConversionResult> {
    return this.#doAsync({
      method: "measure-conversion",
      options,
    });
  }

  logBackendState(): Promise<void> {
    return this.#doAsync({ method: "log-state", options: undefined });
  }
}
