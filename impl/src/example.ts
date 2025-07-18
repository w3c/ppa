import { Frontend } from "./frontend";

async function run() {
  const frontend = new Frontend();

  await frontend.saveImpression({ histogramIndex: 0 });

  console.log("after saveImpression");
  await frontend.logBackendState();

  const { unencryptedHistogram } = await frontend.measureConversion({
    aggregationService: "",
    histogramSize: 3,
    value: 5,
    maxValue: 10,
  });

  console.log("unencrypted histogram", unencryptedHistogram);

  console.log("after measureConversion");
  await frontend.logBackendState();
}

void run();
