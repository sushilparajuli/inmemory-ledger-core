import { describe, expect, it } from "vitest";
import { LedgerEngine } from "./engine";
import type { LedgerEvent } from "../types";

describe("LedgerEngine", () => {
  describe("Append-only posted ledger entries", () => {
    it("appends posted entries sequentially", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      const event1: LedgerEvent = {
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n, // AED 1,000.00
      };

      const event2: LedgerEvent = {
        id: "E2",
        postedDay: 1,
        valueDay: 1,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 30000n, // AED 300.00
      };

      engine.postEvent(event1);
      engine.postEvent(event2);

      expect(engine.entries).toHaveLength(2);
      expect(engine.entries[0]?.id).toBe("E1");
      expect(engine.entries[1]?.id).toBe("E2");
      expect(engine.getEntriesForAccount("acc-1")).toHaveLength(2);
    });

    it("rejects posting for non-existent accounts", () => {
      const engine = new LedgerEngine();
      const event: LedgerEvent = {
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "non-existent",
        amount: 10000n,
      };

      expect(() => engine.postEvent(event)).toThrow("Account not found: non-existent");
    });
  });

  describe("getClosingBalance(accountId, valueDay)", () => {
    it("filters entries where value_date <= valueDay and sums amounts", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Post-Day 1 credit (val: 1)
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n, // +1000.00
      });

      // Post-Day 2 debit (val: 2)
      engine.postEvent({
        id: "E2",
        postedDay: 2,
        valueDay: 2,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 20000n, // -200.00
      });

      // Post-Day 3 debit (val: 4 - future value date)
      engine.postEvent({
        id: "E3",
        postedDay: 3,
        valueDay: 4,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 15000n, // -150.00
      });

      // Day 1 closing balance: only E1 (1000.00)
      expect(engine.getClosingBalance("acc-1", 1)).toBe(100000n);

      // Day 2 closing balance: E1 + E2 (800.00)
      expect(engine.getClosingBalance("acc-1", 2)).toBe(80000n);

      // Day 3 closing balance: E3 has valueDay 4 so excluded (800.00)
      expect(engine.getClosingBalance("acc-1", 3)).toBe(80000n);

      // Day 4 closing balance: E1 + E2 + E3 (650.00)
      expect(engine.getClosingBalance("acc-1", 4)).toBe(65000n);
    });

    it("ignores authorizations and accounts for settlements and reversals", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 50000n,
      });

      // Authorization hold (does not affect ledger balance)
      engine.postEvent({
        id: "AUTH-1",
        postedDay: 1,
        valueDay: 1,
        type: "AUTHORIZATION",
        accountId: "acc-1",
        amount: 20000n,
        authId: "A1",
      });

      expect(engine.getClosingBalance("acc-1", 1)).toBe(50000n);

      // Settlement
      engine.postEvent({
        id: "SETTLE-1",
        postedDay: 2,
        valueDay: 2,
        type: "SETTLEMENT",
        accountId: "acc-1",
        amount: 20000n,
        authId: "A1",
      });

      expect(engine.getClosingBalance("acc-1", 2)).toBe(30000n);
    });
  });

  describe("Daily Interest Check (0.04% on positive closing balance)", () => {
    it("calculates 0.04% rounded to currency precision and records accrual", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Post AED 1,000.00 (100,000 minor units)
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n,
      });

      // 100,000 * 0.0004 = 40 minor units (AED 0.40)
      const interest = engine.calculateDailyInterest("acc-1", 1);
      expect(interest).toBe(40n);

      engine.recordDailyAccrual("acc-1", 1, interest);
      expect(engine.getDailyAccrual("acc-1", 1)).toBe(40n);
    });

    it("accrues zero interest on zero or negative closing balance", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 5000n,
      });

      expect(engine.getClosingBalance("acc-1", 1)).toBe(-5000n);
      expect(engine.calculateDailyInterest("acc-1", 1)).toBe(0n);
    });

    it("rounds fractional interest using configured rounding mode", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Balance = 12,345 minor units (AED 123.45)
      // 12345 * 4 / 10000 = 4.938 -> rounds to 5
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 12345n,
      });

      expect(engine.calculateDailyInterest("acc-1", 1)).toBe(5n);
    });
  });

  describe("Overdraft Check (Day 5) with backdated entry E7", () => {
    it("assesses AED 25.00 overdraft fee on Day 5 when backdated entry E7 causes Day 2 negative closing balance", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Day 1: Credit AED 1,000.00
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n, // +1000.00
      });

      // Day 2: Debit AED 800.00 (closing bal was 200.00)
      engine.postEvent({
        id: "E2",
        postedDay: 2,
        valueDay: 2,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 80000n, // -800.00
      });

      // Day 3: Credit AED 1,000.00 (closing bal was 1200.00)
      engine.postEvent({
        id: "E3",
        postedDay: 3,
        valueDay: 3,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n, // +1000.00
      });

      // Day 4: Debit AED 500.00 (closing bal was 700.00)
      engine.postEvent({
        id: "E4",
        postedDay: 4,
        valueDay: 4,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 50000n, // -500.00
      });

      // Day 5: Backdated entry E7 posted on Day 5 with valueDay = 2 of Debit AED 300.00
      // Now Day 2 balance becomes 1000 - 800 - 300 = -100.00 (negative!)
      engine.postEvent({
        id: "E7",
        postedDay: 5,
        valueDay: 2,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 30000n, // -300.00
      });

      // Verify Day 2 closing balance is now negative
      expect(engine.getClosingBalance("acc-1", 2)).toBe(-10000n);

      // Perform Day 5 Overdraft check
      const feeEvent = engine.checkAndAssessOverdraftFee("acc-1", 5);

      expect(feeEvent).not.toBeNull();
      expect(feeEvent?.type).toBe("DEBIT");
      expect(feeEvent?.amount).toBe(2500n); // AED 25.00
      expect(feeEvent?.postedDay).toBe(5);
      expect(feeEvent?.valueDay).toBe(5);

      // Ensure overdraft fee is not assessed twice
      const secondCheck = engine.checkAndAssessOverdraftFee("acc-1", 5);
      expect(secondCheck).toBeNull();
    });

    it("assesses overdraft fee when backdated entry causes Day 4 negative closing balance", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Day 1: Credit AED 500.00
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 50000n,
      });

      // Day 4: Debit AED 400.00
      engine.postEvent({
        id: "E4",
        postedDay: 4,
        valueDay: 4,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 40000n,
      });

      // Day 5: Backdated entry posted on Day 5 with valueDay = 4 of Debit AED 200.00
      engine.postEvent({
        id: "E7",
        postedDay: 5,
        valueDay: 4,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 20000n,
      });

      // Day 4 closing balance: 50000 - 40000 - 20000 = -10000 (< 0)
      expect(engine.getClosingBalance("acc-1", 4)).toBe(-10000n);

      const feeEvent = engine.checkAndAssessOverdraftFee("acc-1", 5);
      expect(feeEvent).not.toBeNull();
      expect(feeEvent?.amount).toBe(2500n);
    });

    it("does not assess fee if all historical balances remain positive", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 100000n,
      });

      const feeEvent = engine.checkAndAssessOverdraftFee("acc-1", 5);
      expect(feeEvent).toBeNull();
    });
  });

  describe("Day 6 Capitalization", () => {
    it("sums daily rounded accruals and posts a single CREDIT event on Day 6", () => {
      const engine = new LedgerEngine();
      engine.createAccount("acc-1", 0n, "AED");

      // Manually set or simulate accruals for days 1 to 5
      engine.recordDailyAccrual("acc-1", 1, 40n); // 0.40 AED
      engine.recordDailyAccrual("acc-1", 2, 0n); // 0.00 AED (overdrawn)
      engine.recordDailyAccrual("acc-1", 3, 36n); // 0.36 AED
      engine.recordDailyAccrual("acc-1", 4, 30n); // 0.30 AED
      engine.recordDailyAccrual("acc-1", 5, 25n); // 0.25 AED

      // Total accrued interest = 40 + 0 + 36 + 30 + 25 = 131 minor units (AED 1.31)
      const capEvent = engine.capitalizeInterest("acc-1", 6);

      expect(capEvent).not.toBeNull();
      expect(capEvent?.type).toBe("CREDIT");
      expect(capEvent?.amount).toBe(131n);
      expect(capEvent?.postedDay).toBe(6);
      expect(capEvent?.valueDay).toBe(6);

      // Verify that calling capital again does not double-credit
      const secondCap = engine.capitalizeInterest("acc-1", 6);
      expect(secondCap).toBeNull();
    });
  });

  describe("Full End-of-Day (EOD) Lifecycle Simulation (Days 1–6)", () => {
    it("simulates Days 1 to 6 with interest accrual, backdated E7 on Day 5, overdraft fee, and Day 6 capitalization", () => {
      const engine = new LedgerEngine();
      engine.createAccount("ACC-MAIN", 0n, "AED");

      // --- Day 1 ---
      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "ACC-MAIN",
        amount: 100000n, // AED 1,000.00
      });
      const eod1 = engine.processEODForAccount("ACC-MAIN", 1);
      expect(eod1.closingBalance).toBe(100000n);
      expect(eod1.dailyInterest).toBe(40n); // 100,000 * 0.0004 = 40n

      // --- Day 2 ---
      engine.postEvent({
        id: "E2",
        postedDay: 2,
        valueDay: 2,
        type: "DEBIT",
        accountId: "ACC-MAIN",
        amount: 80000n, // AED 800.00
      });
      const eod2 = engine.processEODForAccount("ACC-MAIN", 2);
      expect(eod2.closingBalance).toBe(20000n); // AED 200.00
      expect(eod2.dailyInterest).toBe(8n); // 20,000 * 0.0004 = 8n

      // --- Day 3 ---
      engine.postEvent({
        id: "E3",
        postedDay: 3,
        valueDay: 3,
        type: "CREDIT",
        accountId: "ACC-MAIN",
        amount: 150000n, // AED 1,500.00
      });
      const eod3 = engine.processEODForAccount("ACC-MAIN", 3);
      expect(eod3.closingBalance).toBe(170000n); // AED 1,700.00
      expect(eod3.dailyInterest).toBe(68n); // 170,000 * 0.0004 = 68n

      // --- Day 4 ---
      engine.postEvent({
        id: "E4",
        postedDay: 4,
        valueDay: 4,
        type: "DEBIT",
        accountId: "ACC-MAIN",
        amount: 50000n, // AED 500.00
      });
      const eod4 = engine.processEODForAccount("ACC-MAIN", 4);
      expect(eod4.closingBalance).toBe(120000n); // AED 1,200.00
      expect(eod4.dailyInterest).toBe(48n); // 120,000 * 0.0004 = 48n

      // --- Day 5 ---
      // Post backdated entry E7 on Day 5 with valueDay = 2 of Debit AED 300.00 (30,000 fils)
      // This makes Day 2 closing balance = 100,000 - 80000 - 30000 = -10,000 (negative!)
      engine.postEvent({
        id: "E7",
        postedDay: 5,
        valueDay: 2,
        type: "DEBIT",
        accountId: "ACC-MAIN",
        amount: 30000n,
      });

      // Run EOD for Day 5
      const eod5 = engine.processEODForAccount("ACC-MAIN", 5);
      expect(eod5.overdraftFeeAssessed).toBe(true);
      expect(eod5.overdraftFeeEvent).toBeDefined();
      expect(eod5.overdraftFeeEvent?.amount).toBe(2500n); // AED 25.00 fee assessed
      // Closing balance on Day 5:
      // Day 1 (+100000) - Day 2 (80000) + Day 3 (150000) - Day 4 (50000) - E7 (30000) - Fee (2500) = 87500
      expect(eod5.closingBalance).toBe(87500n);
      // Interest on 87500: 87500 * 0.0004 = 35n
      expect(eod5.dailyInterest).toBe(35n);

      // --- Day 6 ---
      // Run EOD for Day 6:
      // Capitalization sums accruals from Day 1 to 5: 40 + 8 + 68 + 48 + 35 = 199n
      const eod6 = engine.processEODForAccount("ACC-MAIN", 6);
      expect(eod6.capitalizationEvent).toBeDefined();
      expect(eod6.capitalizationEvent?.amount).toBe(199n);
      expect(eod6.capitalizationEvent?.type).toBe("CREDIT");
      // Closing balance on Day 6: 87500 + 199 = 87699
      expect(eod6.closingBalance).toBe(87699n);
      // Day 6 Interest: 87699 * 0.0004 = 35.0796 -> 35n
      expect(eod6.dailyInterest).toBe(35n);
    });

    it("runs automated multi-day simulation using runSimulation", () => {
      const engine = new LedgerEngine();
      engine.createAccount("ACC-1", 0n, "AED");

      engine.postEvent({
        id: "E1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "ACC-1",
        amount: 200000n, // AED 2,000.00
      });

      const simResults = engine.runSimulation(1, 6);
      expect(simResults.size).toBe(6);

      const day6Result = simResults.get(6)?.get("ACC-1");
      expect(day6Result).toBeDefined();
      // 200000 * 0.0004 = 80n per day * 5 days = 400n capitalized on Day 6
      expect(day6Result?.capitalizationEvent?.amount).toBe(400n);
    });
  });
});
