/**
 * Standard ISO 4217 minor unit exponents (decimals).
 * Default to 2 decimals if currency is not listed.
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  // 0 decimals
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,

  // 3 decimals
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,

  // 4 decimals
  CLF: 4,
  UYW: 4,

  // Common 2 decimals explicitly listed
  AED: 2,
  AUD: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  INR: 2,
  MXN: 2,
  NOK: 2,
  NZD: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  TRY: 2,
  USD: 2,
  ZAR: 2,
};

export type RoundingMode =
  | "HALF_EVEN" // Banker's rounding: round to nearest even integer (default)
  | "HALF_UP" // Round half towards +infinity (standard math rounding)
  | "HALF_DOWN" // Round half towards -infinity
  | "UP" // Round away from zero
  | "DOWN" // Round towards zero (truncate)
  | "CEIL" // Round towards +infinity
  | "FLOOR"; // Round towards -infinity

export class CurrencyMismatchError extends Error {
  constructor(c1: string, c2: string) {
    super(`Currency mismatch: cannot operate between ${c1} and ${c2}`);
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Registry helper to get the decimal places for a currency code.
 */
export function getCurrencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  return CURRENCY_DECIMALS[code] ?? 2;
}

/**
 * Register or override currency decimal precision.
 */
export function registerCurrency(currency: string, decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError("Decimals must be a non-negative integer");
  }
  CURRENCY_DECIMALS[currency.toUpperCase()] = decimals;
}

/**
 * Rounds a quotient (numerator / denominator) using the specified RoundingMode.
 */
export function roundDivision(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = "HALF_EVEN"
): bigint {
  if (denominator === 0n) {
    throw new RangeError("Division by zero");
  }

  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) {
    return quotient;
  }

  const isPositive = numerator > 0n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const doubleRemainder = absRemainder * 2n;

  switch (mode) {
    case "DOWN":
      return quotient;
    case "UP":
      return isPositive ? quotient + 1n : quotient - 1n;
    case "CEIL":
      return isPositive ? quotient + 1n : quotient;
    case "FLOOR":
      return isPositive ? quotient : quotient - 1n;
    case "HALF_UP":
      if (isPositive) {
        return doubleRemainder >= denominator ? quotient + 1n : quotient;
      } else {
        return doubleRemainder > denominator ? quotient - 1n : quotient;
      }
    case "HALF_DOWN":
      if (isPositive) {
        return doubleRemainder > denominator ? quotient + 1n : quotient;
      } else {
        return doubleRemainder >= denominator ? quotient - 1n : quotient;
      }
    case "HALF_EVEN": {
      if (doubleRemainder > denominator) {
        return isPositive ? quotient + 1n : quotient - 1n;
      } else if (doubleRemainder < denominator) {
        return quotient;
      } else {
        // Exactly half: round to nearest even number
        const absQuotient = quotient < 0n ? -quotient : quotient;
        if (absQuotient % 2n === 1n) {
          return isPositive ? quotient + 1n : quotient - 1n;
        }
        return quotient;
      }
    }
  }
}

/**
 * Represents immutable monetary value strictly stored as integer minor units.
 * Examples:
 * - 120000 AED = 1,200.00 AED
 * - 10000 BHD = 10.000 BHD
 */
export class Money {
  readonly amount: bigint;
  readonly currency: string;

  constructor(amount: bigint | number, currency: string) {
    if (typeof amount === "number") {
      if (!Number.isInteger(amount) || !Number.isSafeInteger(amount)) {
        throw new TypeError(
          `Amount must be a safe integer representing minor units. Received: ${amount}`
        );
      }
      this.amount = BigInt(amount);
    } else if (typeof amount === "bigint") {
      this.amount = amount;
    } else {
      throw new TypeError(`Invalid amount type: ${typeof amount}`);
    }

    if (!currency || typeof currency !== "string" || currency.trim() === "") {
      throw new TypeError("Currency must be a non-empty string");
    }

    this.currency = currency.trim().toUpperCase();
  }

  /**
   * Creates a Money instance from minor units (e.g., cents, fils).
   */
  static fromMinor(amount: bigint | number, currency: string): Money {
    return new Money(amount, currency);
  }

  /**
   * Creates a Money instance from major units (e.g. 1200 AED -> 120000 AED minor units).
   * Supports decimal string or number representation.
   */
  static fromMajor(
    majorAmount: number | string,
    currency: string,
    roundingMode: RoundingMode = "HALF_EVEN"
  ): Money {
    const decimals = getCurrencyDecimals(currency);
    const scale = 10n ** BigInt(decimals);

    if (typeof majorAmount === "string") {
      const trimmed = majorAmount.trim();
      const parts = trimmed.split(".");
      if (parts.length > 2) {
        throw new TypeError(`Invalid decimal string: ${majorAmount}`);
      }
      const intRaw = parts[0] ?? "";
      const isNegative = intRaw.startsWith("-");
      const intPartStr = intRaw.replace(/^-/, "");
      if (!/^\d*$/.test(intPartStr)) {
        throw new TypeError(`Invalid integer part: ${intRaw}`);
      }
      const intPart = intPartStr === "" ? 0n : BigInt(intPartStr);

      const fracStr = parts[1];
      if (fracStr === undefined) {
        const minor = intPart * scale;
        return new Money(isNegative ? -minor : minor, currency);
      }

      if (!/^\d+$/.test(fracStr)) {
        throw new TypeError(`Invalid fractional part: ${fracStr}`);
      }

      if (fracStr.length <= decimals) {
        const paddedFrac = fracStr.padEnd(decimals, "0");
        const fracPart = BigInt(paddedFrac);
        const minor = intPart * scale + fracPart;
        return new Money(isNegative ? -minor : minor, currency);
      } else {
        // Fractional part exceeds currency precision, perform rounding
        const numerator =
          (intPart * 10n ** BigInt(fracStr.length) + BigInt(fracStr)) *
          scale *
          (isNegative ? -1n : 1n);
        const denominator = 10n ** BigInt(fracStr.length);
        const minor = roundDivision(numerator, denominator, roundingMode);
        return new Money(minor, currency);
      }
    }

    if (typeof majorAmount === "number") {
      if (!Number.isFinite(majorAmount)) {
        throw new TypeError("Major amount must be a finite number");
      }
      // Convert via exact decimal string or floating conversion with scaled division
      const str = majorAmount.toString();
      if (!str.includes("e") && !str.includes("E")) {
        return Money.fromMajor(str, currency, roundingMode);
      }
      // Fallback for scientific notation
      const scaled = majorAmount * Number(scale);
      const rounded = Math.round(scaled);
      return new Money(BigInt(rounded), currency);
    }

    throw new TypeError(`Invalid majorAmount type: ${typeof majorAmount}`);
  }

  /**
   * Creates a zero-value Money instance for the given currency.
   */
  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  /**
   * Returns the number of decimal places for this currency.
   */
  get decimals(): number {
    return getCurrencyDecimals(this.currency);
  }

  /**
   * Check whether two Money instances have the same currency.
   */
  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  /**
   * Addition of two money values with the same currency.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  /**
   * Subtraction of two money values with the same currency.
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  /**
   * Multiplies money value by a scalar factor and rounds using the specified mode.
   */
  multiply(factor: number | bigint | string, mode: RoundingMode = "HALF_EVEN"): Money {
    if (typeof factor === "bigint") {
      return new Money(this.amount * factor, this.currency);
    }

    if (typeof factor === "number") {
      if (!Number.isFinite(factor)) {
        throw new TypeError("Factor must be a finite number");
      }
      if (Number.isInteger(factor)) {
        return new Money(this.amount * BigInt(factor), this.currency);
      }
      // Convert floating factor to rational numerator/denominator to avoid precision loss
      const factorStr = factor.toString();
      return this.multiply(factorStr, mode);
    }

    if (typeof factor === "string") {
      const parts = factor.trim().split(".");
      const intRaw = parts[0] ?? "";
      const isNegative = intRaw.startsWith("-");
      const intPartStr = intRaw.replace(/^-/, "");
      const intPart = intPartStr === "" ? 0n : BigInt(intPartStr);

      const fracStr = parts[1];
      if (fracStr === undefined) {
        const factorBig = isNegative ? -intPart : intPart;
        return new Money(this.amount * factorBig, this.currency);
      }

      const denominator = 10n ** BigInt(fracStr.length);
      const totalFactor = intPart * denominator + BigInt(fracStr);
      const factorBig = isNegative ? -totalFactor : totalFactor;
      const numerator = this.amount * factorBig;
      const roundedAmount = roundDivision(numerator, denominator, mode);
      return new Money(roundedAmount, this.currency);
    }

    throw new TypeError(`Invalid factor type: ${typeof factor}`);
  }

  /**
   * Divides money value by a scalar divisor and rounds using the specified mode.
   */
  divide(divisor: number | bigint, mode: RoundingMode = "HALF_EVEN"): Money {
    if (typeof divisor === "bigint") {
      if (divisor === 0n) throw new RangeError("Division by zero");
      return new Money(roundDivision(this.amount, divisor, mode), this.currency);
    }

    if (typeof divisor === "number") {
      if (!Number.isFinite(divisor) || divisor === 0) {
        throw new RangeError("Divisor must be a non-zero finite number");
      }
      if (Number.isInteger(divisor)) {
        return new Money(roundDivision(this.amount, BigInt(divisor), mode), this.currency);
      }
      // Rational conversion
      const divisorStr = divisor.toString();
      const parts = divisorStr.trim().split(".");
      const intRaw = parts[0] ?? "";
      const isNegative = intRaw.startsWith("-");
      const intPartStr = intRaw.replace(/^-/, "");
      const intPart = intPartStr === "" ? 0n : BigInt(intPartStr);
      const fracStr = parts[1] ?? "";
      const scale = 10n ** BigInt(fracStr.length);
      const denominator = intPart * scale + (fracStr === "" ? 0n : BigInt(fracStr));
      const signedDenominator = isNegative ? -denominator : denominator;
      const numerator = this.amount * scale;
      return new Money(roundDivision(numerator, signedDenominator, mode), this.currency);
    }

    throw new TypeError(`Invalid divisor type: ${typeof divisor}`);
  }

  /**
   * Returns negation of this Money amount.
   */
  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  /**
   * Returns absolute value of this Money amount.
   */
  abs(): Money {
    return new Money(this.amount < 0n ? -this.amount : this.amount, this.currency);
  }

  /**
   * Compares two Money objects.
   * Returns:
   *  -1 if this < other
   *   0 if this == other
   *   1 if this > other
   */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amount < other.amount) return -1;
    if (this.amount > other.amount) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  /**
   * Allocates the money into N equal or near-equal parts without losing any minor units.
   * Example: 10.000 BHD (10000 minor units) into 3 parts => [3.334, 3.333, 3.333] BHD
   * (minor units: [3334, 3333, 3333])
   */
  split(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new RangeError("Parts must be a positive integer");
    }
    return this.allocate(Array(parts).fill(1));
  }

  /**
   * Allocates the money proportionally according to ratios/weights without losing any minor units.
   * Uses largest remainder distribution to ensure the sum of all allocated parts exactly equals
   * the original total.
   *
   * Example:
   * Allocating 10.000 BHD with ratios [1, 1, 1] gives parts with minor amounts [3334, 3333, 3333].
   */
  allocate(ratios: (number | bigint)[]): Money[] {
    if (!Array.isArray(ratios) || ratios.length === 0) {
      throw new Error("Ratios must be a non-empty array");
    }

    // Convert all ratios to scaled BigInts
    let maxDecimals = 0;
    for (const r of ratios) {
      if (typeof r === "number") {
        if (!Number.isFinite(r) || r < 0) {
          throw new RangeError("Ratio elements must be non-negative finite numbers");
        }
        const str = r.toString();
        if (str.includes(".")) {
          const parts = str.split(".");
          const frac = parts[1];
          if (frac !== undefined && frac.length > maxDecimals) {
            maxDecimals = frac.length;
          }
        }
      } else if (typeof r === "bigint") {
        if (r < 0n) {
          throw new RangeError("Ratio elements must be non-negative");
        }
      } else {
        throw new TypeError("Ratio elements must be numbers or bigints");
      }
    }

    const scaleFactor = 10n ** BigInt(maxDecimals);
    const bigRatios: bigint[] = ratios.map((r) => {
      if (typeof r === "bigint") {
        return r * scaleFactor;
      }
      return BigInt(Math.round(r * Number(scaleFactor)));
    });

    const totalRatio = bigRatios.reduce<bigint>((acc, r) => acc + r, 0n);

    if (totalRatio === 0n) {
      throw new RangeError("Sum of ratios must be greater than zero");
    }

    const isNegative = this.amount < 0n;
    const absAmount = isNegative ? -this.amount : this.amount;

    let remainder = absAmount;
    const results: bigint[] = [];
    const remainders: { index: number; remainderFraction: bigint }[] = [];

    for (let i = 0; i < bigRatios.length; i++) {
      const r = bigRatios[i]!;
      const share = (absAmount * r) / totalRatio;
      const frac = (absAmount * r) % totalRatio;
      results.push(share);
      remainder -= share;
      remainders.push({ index: i, remainderFraction: frac });
    }

    // Sort remainders descending by remainder fraction to distribute leftover minor units
    remainders.sort((a, b) => {
      if (b.remainderFraction > a.remainderFraction) return 1;
      if (b.remainderFraction < a.remainderFraction) return -1;
      return a.index - b.index; // Stable sort preserving original order
    });

    for (let i = 0; i < Number(remainder); i++) {
      const remItem = remainders[i]!;
      results[remItem.index] = (results[remItem.index] ?? 0n) + 1n;
    }

    return results.map((minor) => new Money(isNegative ? -minor : minor, this.currency));
  }

  /**
   * Converts the minor unit amount to a standard decimal string (e.g., "1200.00" or "10.000").
   */
  toDecimal(): string {
    const decimals = this.decimals;
    const isNegative = this.amount < 0n;
    const absAmount = isNegative ? -this.amount : this.amount;

    if (decimals === 0) {
      return (isNegative ? "-" : "") + absAmount.toString();
    }

    const scale = 10n ** BigInt(decimals);
    const intPart = absAmount / scale;
    const fracPart = absAmount % scale;
    const fracStr = fracPart.toString().padStart(decimals, "0");

    return `${isNegative ? "-" : ""}${intPart.toString()}.${fracStr}`;
  }

  /**
   * Converts to major units as a JavaScript number.
   * Note: May suffer from precision limits for very large numbers (> Number.MAX_SAFE_INTEGER).
   */
  toMajor(): number {
    return Number(this.toDecimal());
  }

  /**
   * Formats the money value with grouping and optional currency symbol/code.
   * Examples:
   * - "1,200.00 AED"
   * - "10.000 BHD"
   */
  format(options?: { currencyDisplay?: "code" | "symbol" | "none" }): string {
    const decimal = this.toDecimal();
    const parts = decimal.split(".");
    const intStr = (parts[0] ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const formattedNum = parts.length > 1 ? `${intStr}.${parts[1]}` : intStr;

    const display = options?.currencyDisplay ?? "code";
    if (display === "none") {
      return formattedNum;
    }
    return `${this.currency} ${formattedNum}`;
  }

  /**
   * Serializes to JSON object.
   */
  toJSON(): { amount: string; currency: string; minorUnits: string; decimals: number } {
    return {
      amount: this.toDecimal(),
      currency: this.currency,
      minorUnits: this.amount.toString(),
      decimals: this.decimals,
    };
  }

  toString(): string {
    return `${this.toDecimal()} ${this.currency}`;
  }
}

/**
 * Convenience helper function to create a Money instance.
 */
export function money(amount: bigint | number, currency: string): Money {
  return Money.fromMinor(amount, currency);
}
