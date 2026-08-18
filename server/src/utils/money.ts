import { Prisma } from "@prisma/client";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export type DecimalInput = Prisma.Decimal | number | string;

export function D(value: DecimalInput): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Round to 2 decimal places (paise), round-half-up — matches how the
 * spec's worked examples round rupee amounts and per-unit rates. */
export function round2(value: DecimalInput): Prisma.Decimal {
  return D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function round3(value: DecimalInput): Prisma.Decimal {
  return D(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Moving weighted-average costing (spec §7-11).
 *
 *   newAvgRate = (openingValue + inwardValue) / (openingQty + inwardQty)
 *
 * `openingValue`/`openingQty` come from the current stock balance row (the
 * running ledger total, not qty * displayed-rate, so no rounding drift
 * accumulates across many inwards). Returns the new balance to persist.
 */
export function applyInward(
  openingQty: DecimalInput,
  openingValue: DecimalInput,
  inwardQty: DecimalInput,
  inwardRate: DecimalInput
) {
  const oQty = D(openingQty);
  const oValue = D(openingValue);
  const iQty = D(inwardQty);
  const iRate = D(inwardRate);
  const inwardValue = round2(iQty.mul(iRate));

  const newQty = round3(oQty.add(iQty));
  const newValue = round2(oValue.add(inwardValue));
  const newAvgRate = newQty.isZero() ? round2(0) : round2(newValue.div(newQty));

  return { newQty, newValue, newAvgRate, inwardValue };
}

/**
 * Stock issue at the current average rate (spec §9). The average rate is
 * NOT recomputed from the post-issue value/quantity — it only ever changes
 * on a new inward — so rounding never drifts the rate across many issues.
 */
export function applyIssue(
  openingQty: DecimalInput,
  openingValue: DecimalInput,
  currentAvgRate: DecimalInput,
  issueQty: DecimalInput
) {
  const oQty = D(openingQty);
  const oValue = D(openingValue);
  const rate = D(currentAvgRate);
  const qty = D(issueQty);

  const issueValue = round2(qty.mul(rate));
  const newQty = round3(oQty.sub(qty));
  const newValue = round2(oValue.sub(issueValue));

  return { newQty, newValue, avgRate: rate, issueValue };
}
