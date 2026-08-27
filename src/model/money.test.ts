import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  Money,
  getCurrencyDecimals,
  money,
  registerCurrency,
  roundDivision,
} from "./money.js";

describe("Money - minor unit representation", () => {
  it("represents currency values strictly as minor-unit integers", () => {
    const aed = new Money(120000, "AED");
    expect(aed.amount).toBe(120000n);
    expect(aed.currency).toBe("AED");
    expect(aed.decimals).toBe(2);
    expect(aed.toDecimal()).toBe("1200.00");

    const bhd = new Money(10000n, "BHD");
    expect(bhd.amount).toBe(10000n);
    expect(bhd.currency).toBe("BHD");
    expect(bhd.decimals).toBe(3);
    expect(bhd.toDecimal()).toBe("10.000");

    const jpy = money(500, "JPY");
    expect(jpy.amount).toBe(500n);
    expect(jpy.decimals).toBe(0);
    expect(jpy.toDecimal()).toBe("500");
  });

  it("throws when initialized with non-integer minor units", () => {
    expect(() => new Money(12.34 as unknown as number, "AED")).toThrow(TypeError);
    expect(() => Money.fromMinor(100.5, "USD")).toThrow(TypeError);
    expect(() => new Money(NaN, "AED")).toThrow(TypeError);
  });

  it("throws when currency is invalid", () => {
    expect(() => new Money(100, "")).toThrow(TypeError);
    expect(() => new Money(100, "   ")).toThrow(TypeError);
  });
});

describe("Money - creation from major units", () => {
  it("converts major units to minor units for various currencies", () => {
    const aed = Money.fromMajor(1200, "AED");
    expect(aed.amount).toBe(120000n);
    expect(aed.toDecimal()).toBe("1200.00");

    const bhd = Money.fromMajor("10.000", "BHD");
    expect(bhd.amount).toBe(10000n);
    expect(bhd.toDecimal()).toBe("10.000");

    const usd = Money.fromMajor("12.34", "USD");
    expect(usd.amount).toBe(1234n);

    const jpy = Money.fromMajor(500, "JPY");
    expect(jpy.amount).toBe(500n);

    const clf = Money.fromMajor("12.3456", "CLF");
    expect(clf.amount).toBe(123456n);
    expect(clf.toDecimal()).toBe("12.3456");
  });

  it("handles negative major amounts", () => {
    const neg = Money.fromMajor("-12.50", "AED");
    expect(neg.amount).toBe(-1250n);
    expect(neg.toDecimal()).toBe("-12.50");
  });

  it("rounds major units when precision exceeds currency decimals", () => {
    // 12.345 USD with 2 decimals -> 1234.5 cents -> Banker's rounds to 1234 (even) or 12.355 -> 1236 (even)
    const m1 = Money.fromMajor("12.345", "USD", "HALF_EVEN");
    expect(m1.amount).toBe(1234n);

    const m2 = Money.fromMajor("12.355", "USD", "HALF_EVEN");
    expect(m2.amount).toBe(1236n);

    const m3 = Money.fromMajor("12.345", "USD", "HALF_UP");
    expect(m3.amount).toBe(1235n);
  });

  it("creates zero money", () => {
    const z = Money.zero("BHD");
    expect(z.amount).toBe(0n);
    expect(z.isZero()).toBe(true);
  });
});

describe("Money - allocation & splitting", () => {
  it("allocates 10.000 BHD into 3 parts: 3.334, 3.333, 3.333", () => {
    const total = Money.fromMajor("10.000", "BHD"); // 10000 minor units
    const parts = total.split(3);

    expect(parts.length).toBe(3);
    expect(parts[0]?.amount).toBe(3334n);
    expect(parts[1]?.amount).toBe(3333n);
    expect(parts[2]?.amount).toBe(3333n);

    expect(parts[0]?.toDecimal()).toBe("3.334");
    expect(parts[1]?.toDecimal()).toBe("3.333");
    expect(parts[2]?.toDecimal()).toBe("3.333");

    // Sum of parts must exactly equal original amount
    const sum = parts.reduce((acc, p) => acc.add(p), Money.zero("BHD"));
    expect(sum.equals(total)).toBe(true);
    expect(sum.amount).toBe(10000n);
  });

  it("allocates according to custom ratios (weights)", () => {
    const total = money(100n, "USD");
    const parts = total.allocate([1, 2, 1]); // 25, 50, 25
    expect(parts.map((p) => p.amount)).toEqual([25n, 50n, 25n]);

    // 100 cents allocated 1:1:1 -> 34, 33, 33
    const thirds = total.allocate([1, 1, 1]);
    expect(thirds.map((p) => p.amount)).toEqual([34n, 33n, 33n]);
    expect(thirds.reduce((acc, p) => acc + p.amount, 0n)).toBe(100n);
  });

  it("allocates with float ratios", () => {
    const total = money(1000n, "AED"); // 10.00 AED
    const parts = total.allocate([0.7, 0.3]);
    expect(parts.map((p) => p.amount)).toEqual([700n, 300n]);
    expect(parts.reduce((acc, p) => acc + p.amount, 0n)).toBe(1000n);
  });

  it("allocates negative money correctly without losing minor units", () => {
    const total = money(-10000n, "BHD");
    const parts = total.split(3);
    expect(parts.map((p) => p.amount)).toEqual([-3334n, -3333n, -3333n]);
    expect(parts.reduce((acc, p) => acc.add(p), Money.zero("BHD")).amount).toBe(-10000n);
  });

  it("allocates zero amount correctly", () => {
    const total = Money.zero("AED");
    const parts = total.split(3);
    expect(parts.map((p) => p.amount)).toEqual([0n, 0n, 0n]);
  });

  it("throws on invalid allocation arguments", () => {
    const m = money(100, "USD");
    expect(() => m.split(0)).toThrow(RangeError);
    expect(() => m.split(-1)).toThrow(RangeError);
    expect(() => m.allocate([])).toThrow();
    expect(() => m.allocate([0, 0])).toThrow(RangeError);
    expect(() => m.allocate([-1, 2])).toThrow(RangeError);
  });
});

describe("Rounding & Division helpers", () => {
  it("rounds division using Banker's rounding (HALF_EVEN)", () => {
    // 5 / 2 = 2.5 -> rounds to 2 (nearest even)
    expect(roundDivision(5n, 2n, "HALF_EVEN")).toBe(2n);
    // 7 / 2 = 3.5 -> rounds to 4 (nearest even)
    expect(roundDivision(7n, 2n, "HALF_EVEN")).toBe(4n);
    // -5 / 2 = -2.5 -> rounds to -2
    expect(roundDivision(-5n, 2n, "HALF_EVEN")).toBe(-2n);
    // -7 / 2 = -3.5 -> rounds to -4
    expect(roundDivision(-7n, 2n, "HALF_EVEN")).toBe(-4n);
  });

  it("rounds division using HALF_UP", () => {
    expect(roundDivision(5n, 2n, "HALF_UP")).toBe(3n);
    expect(roundDivision(7n, 2n, "HALF_UP")).toBe(4n);
    expect(roundDivision(-5n, 2n, "HALF_UP")).toBe(-2n);
  });

  it("rounds division using HALF_DOWN", () => {
    expect(roundDivision(5n, 2n, "HALF_DOWN")).toBe(2n);
    expect(roundDivision(7n, 2n, "HALF_DOWN")).toBe(3n);
  });

  it("rounds division using UP, DOWN, CEIL, FLOOR", () => {
    expect(roundDivision(5n, 3n, "DOWN")).toBe(1n);
    expect(roundDivision(5n, 3n, "UP")).toBe(2n);
    expect(roundDivision(-5n, 3n, "DOWN")).toBe(-1n);
    expect(roundDivision(-5n, 3n, "UP")).toBe(-2n);
    expect(roundDivision(-5n, 3n, "FLOOR")).toBe(-2n);
    expect(roundDivision(-5n, 3n, "CEIL")).toBe(-1n);
  });

  it("multiplies and divides Money with rounding", () => {
    const aed = money(100n, "AED"); // 1.00 AED
    const mult = aed.multiply(1.5, "HALF_EVEN"); // 150 cents
    expect(mult.amount).toBe(150n);

    const mult2 = aed.multiply("0.3333", "HALF_UP"); // 33.33 cents -> 33
    expect(mult2.amount).toBe(33n);

    const div = aed.divide(3, "HALF_UP"); // 100 / 3 = 33.333 -> 33
    expect(div.amount).toBe(33n);

    const div2 = money(10n, "AED").divide(4, "HALF_EVEN"); // 10 / 4 = 2.5 -> 2
    expect(div2.amount).toBe(2n);
  });
});

describe("Money - arithmetic and comparisons", () => {
  it("adds and subtracts same currency", () => {
    const m1 = money(120000n, "AED");
    const m2 = money(30000n, "AED");

    expect(m1.add(m2).amount).toBe(150000n);
    expect(m1.subtract(m2).amount).toBe(90000n);
    expect(m1.negate().amount).toBe(-120000n);
    expect(m1.negate().abs().amount).toBe(120000n);
  });

  it("throws CurrencyMismatchError when operating between different currencies", () => {
    const aed = money(100n, "AED");
    const bhd = money(100n, "BHD");

    expect(() => aed.add(bhd)).toThrow(CurrencyMismatchError);
    expect(() => aed.subtract(bhd)).toThrow(CurrencyMismatchError);
    expect(() => aed.compare(bhd)).toThrow(CurrencyMismatchError);
  });

  it("compares correctly", () => {
    const m1 = money(100n, "USD");
    const m2 = money(200n, "USD");
    const m3 = money(100n, "USD");

    expect(m1.equals(m3)).toBe(true);
    expect(m1.equals(m2)).toBe(false);
    expect(m1.lessThan(m2)).toBe(true);
    expect(m2.greaterThan(m1)).toBe(true);
    expect(m1.lessThanOrEqual(m3)).toBe(true);
    expect(m1.greaterThanOrEqual(m3)).toBe(true);
    expect(m1.isPositive()).toBe(true);
    expect(money(-10n, "USD").isNegative()).toBe(true);
    expect(Money.zero("USD").isZero()).toBe(true);
  });
});

describe("Money - formatting and serialization", () => {
  it("formats currency values nicely", () => {
    const aed = money(120000n, "AED");
    expect(aed.format()).toBe("AED 1,200.00");
    expect(aed.format({ currencyDisplay: "none" })).toBe("1,200.00");

    const bhd = money(10000n, "BHD");
    expect(bhd.format()).toBe("BHD 10.000");

    const jpy = money(1234567n, "JPY");
    expect(jpy.format()).toBe("JPY 1,234,567");

    expect(aed.toMajor()).toBe(1200);
    expect(bhd.toMajor()).toBe(10);
    expect(aed.toString()).toBe("1200.00 AED");
  });

  it("serializes to JSON", () => {
    const bhd = money(10000n, "BHD");
    expect(bhd.toJSON()).toEqual({
      amount: "10.000",
      currency: "BHD",
      minorUnits: "10000",
      decimals: 3,
    });
  });

  it("supports registering custom currency decimals", () => {
    registerCurrency("XYZ", 4);
    expect(getCurrencyDecimals("XYZ")).toBe(4);
    const m = Money.fromMajor("1.2345", "XYZ");
    expect(m.amount).toBe(12345n);
    expect(m.toDecimal()).toBe("1.2345");
  });
});
