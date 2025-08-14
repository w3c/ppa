import { fairlyAllocateCredit } from "./backend";

import { strict as assert } from "assert";
import test from "node:test";

interface FairlyAllocateCreditTestCase {
  name: string;
  credit: number[];
  value: number;
  needsRand?: boolean;
}

function noRand(): number {
  throw new Error("no rand expected");
}

// TODO: Check that the distribution of credit arrays matches expectations.
function runFairlyAllocateCreditTest(
  tc: Readonly<FairlyAllocateCreditTestCase>,
): void {
  // TODO: replace with precise sum
  const sumCredit = tc.credit.reduce((a, b) => a + b, 0);
  const normalizedFloatCredit = tc.credit.map(
    (item) => (tc.value * item) / sumCredit,
  );

  const [rand, k] = tc.needsRand ? [Math.random, 10000] : [noRand, 1];

  for (let n = 0; n < k; ++n) {
    const actualCredit = fairlyAllocateCredit(tc.credit, tc.value, rand);

    assert.equal(actualCredit.length, tc.credit.length);

    for (const [j, actual] of actualCredit.entries()) {
      assert.ok(Number.isInteger(actual));

      const normalized = normalizedFloatCredit[j]!;
      const diff = Math.abs(actual - normalized);
      assert.ok(
        diff <= 1,
        `credit error > 1: actual=${actual}, normalized=${normalized}`,
      );
    }

    assert.equal(
      // TODO: replace with precise sum
      actualCredit.reduce((a, b) => a + b, 0),
      tc.value,
      `actual credit does not sum to value: ${actualCredit.join(", ")}`,
    );
  }
}

const testCases: FairlyAllocateCreditTestCase[] = [
  {
    name: "credit-equal-to-value",
    credit: [1],
    value: 1,
    needsRand: false,
  },
  {
    name: "credit-less-than-value",
    credit: [2],
    value: 3,
    needsRand: false,
  },
  {
    name: "credit-less-than-1",
    credit: [0.25],
    value: 4,
    needsRand: false,
  },
  {
    name: "2-credit-divides-value-evenly",
    credit: [3, 1],
    value: 8,
    needsRand: false,
  },
  {
    name: "3-credit-divides-value-evenly",
    credit: [2, 1, 1],
    value: 8,
    needsRand: false,
  },
  {
    name: "2-credit-divides-value-unevenly",
    credit: [1, 1],
    value: 5,
    needsRand: true,
  },
  {
    name: "3-credit-divides-value-unevenly",
    credit: [2, 1, 1],
    value: 5,
    needsRand: true,
  },
];

void test("fairlyAllocateCredit", async (t) => {
  await Promise.all(
    testCases.map((tc) =>
      t.test(tc.name, () => runFairlyAllocateCreditTest(tc)),
    ),
  );
});
