import { describe, expect, it } from "vitest";
import { Account } from "./account";
import type { LedgerEvent } from "../types";

describe("Account class", () => {
  it("initializes account with id, currency, and balance", () => {
    const acc1 = new Account("acc-123", 100000n, "USD");
    expect(acc1.id).toBe("acc-123");
    expect(acc1.currency).toBe("USD");
    expect(acc1.ledgerBalance).toBe(100000n);
    expect(acc1.getLedgerBalance()).toBe(100000n);
    expect(acc1.getAvailableBalance()).toBe(100000n);
    expect(acc1.holds.size).toBe(0);
    expect(acc1.getTotalHolds()).toBe(0n);

    const acc2 = new Account({ id: "acc-456", currency: "AED", initialBalance: 50000n });
    expect(acc2.id).toBe("acc-456");
    expect(acc2.currency).toBe("AED");
    expect(acc2.ledgerBalance).toBe(50000n);
  });

  it("throws error for invalid account ID", () => {
    expect(() => new Account("")).toThrow(TypeError);
    expect(() => new Account("   ")).toThrow(TypeError);
    expect(() => new Account({ id: "" })).toThrow(TypeError);
  });

  it("calculates available balance as Ledger Balance - ∑(Active Holds)", () => {
    const acc = new Account("acc-1", 10000n, "AED"); // 100.00 AED
    expect(acc.getAvailableBalance()).toBe(10000n);

    // Approve hold 1: 30.00 AED
    const approved1 = acc.processAuthorization("auth-1", 3000n);
    expect(approved1).toBe(true);
    expect(acc.holds.get("auth-1")).toBe(3000n);
    expect(acc.getTotalHolds()).toBe(3000n);
    expect(acc.ledgerBalance).toBe(10000n);
    expect(acc.getAvailableBalance()).toBe(7000n);

    // Approve hold 2: 50.00 AED
    const approved2 = acc.processAuthorization("auth-2", 5000n);
    expect(approved2).toBe(true);
    expect(acc.holds.get("auth-2")).toBe(5000n);
    expect(acc.getTotalHolds()).toBe(8000n);
    expect(acc.ledgerBalance).toBe(10000n);
    expect(acc.getAvailableBalance()).toBe(2000n);
  });

  it("approves AUTHORIZATION when Available Balance >= Hold Amount, and rejects otherwise", () => {
    const acc = new Account("acc-1", 5000n, "USD"); // $50.00

    // Available is 5000. Request 3000 -> Approved
    expect(acc.processAuthorization("auth-1", 3000n)).toBe(true);
    expect(acc.getAvailableBalance()).toBe(2000n);
    expect(acc.holds.size).toBe(1);

    // Available is 2000. Request 2001 -> Rejected
    expect(acc.processAuthorization("auth-2", 2001n)).toBe(false);
    expect(acc.getAvailableBalance()).toBe(2000n);
    expect(acc.holds.has("auth-2")).toBe(false);
    expect(acc.holds.size).toBe(1);

    // Available is 2000. Request exact remaining 2000 -> Approved
    expect(acc.processAuthorization("auth-3", 2000n)).toBe(true);
    expect(acc.getAvailableBalance()).toBe(0n);
    expect(acc.holds.size).toBe(2);

    // Available is 0. Request 1 -> Rejected
    expect(acc.processAuthorization("auth-4", 1n)).toBe(false);
    expect(acc.holds.size).toBe(2);
  });

  it("processes AUTHORIZATION via LedgerEvent", () => {
    const acc = new Account("acc-1", 10000n, "USD");
    const authEvent: LedgerEvent = {
      id: "evt-auth-1",
      postedDay: 1,
      valueDay: 1,
      type: "AUTHORIZATION",
      accountId: "acc-1",
      amount: 4000n,
      authId: "auth-abc",
    };

    const approved = acc.processAuthorization(authEvent);
    expect(approved).toBe(true);
    expect(acc.hasHold("auth-abc")).toBe(true);
    expect(acc.getHold("auth-abc")).toBe(4000n);
    expect(acc.getAvailableBalance()).toBe(6000n);
  });

  describe("SETTLEMENT processing", () => {
    it("releases hold and records ledger debit when authId exists in holds", () => {
      const acc = new Account("acc-1", 10000n, "USD");

      // Place hold of 4000
      acc.processAuthorization("auth-1", 4000n);
      expect(acc.ledgerBalance).toBe(10000n);
      expect(acc.getAvailableBalance()).toBe(6000n);
      expect(acc.holds.has("auth-1")).toBe(true);

      // Matched settlement of 4000
      acc.processSettlement("auth-1", 4000n);
      expect(acc.holds.has("auth-1")).toBe(false);
      expect(acc.ledgerBalance).toBe(6000n);
      expect(acc.getAvailableBalance()).toBe(6000n);
      expect(acc.getTotalHolds()).toBe(0n);
    });

    it("supports partial or adjusted settlement amount on existing hold", () => {
      const acc = new Account("acc-1", 10000n, "USD");

      // Hold of 4000 (e.g. restaurant tip pre-auth)
      acc.processAuthorization("auth-1", 4000n);
      expect(acc.getAvailableBalance()).toBe(6000n);

      // Settle 4500
      acc.processSettlement("auth-1", 4500n);
      expect(acc.holds.has("auth-1")).toBe(false);
      expect(acc.ledgerBalance).toBe(5500n);
      expect(acc.getAvailableBalance()).toBe(5500n);
    });

    it("forces direct ledger debit when authId does not exist in holds (Auth-Z / Unmatched Settlement)", () => {
      const acc = new Account("acc-1", 10000n, "USD");

      // Hold of 2000 on auth-1
      acc.processAuthorization("auth-1", 2000n);
      expect(acc.ledgerBalance).toBe(10000n);
      expect(acc.getAvailableBalance()).toBe(8000n);

      // Unmatched settlement (Auth-Z without pre-auth)
      acc.processSettlement("auth-unknown", 3000n);

      // Unmatched settlement forces debit directly, while auth-1 hold remains active
      expect(acc.ledgerBalance).toBe(7000n);
      expect(acc.holds.get("auth-1")).toBe(2000n);
      expect(acc.getTotalHolds()).toBe(2000n);
      expect(acc.getAvailableBalance()).toBe(5000n);

      // Unmatched settlement with undefined authId
      acc.processSettlement(undefined, 1000n);
      expect(acc.ledgerBalance).toBe(6000n);
      expect(acc.getAvailableBalance()).toBe(4000n);
    });

    it("forces direct debit even if it drives ledger balance negative", () => {
      const acc = new Account("acc-1", 1000n, "USD");
      acc.processSettlement("unmatched-auth", 2500n);
      expect(acc.ledgerBalance).toBe(-1500n);
      expect(acc.getAvailableBalance()).toBe(-1500n);
    });

    it("processes SETTLEMENT via LedgerEvent", () => {
      const acc = new Account("acc-1", 10000n, "USD");
      acc.processAuthorization("auth-matched", 3000n);

      const matchedEvent: LedgerEvent = {
        id: "evt-settle-1",
        postedDay: 1,
        valueDay: 1,
        type: "SETTLEMENT",
        accountId: "acc-1",
        amount: 3000n,
        authId: "auth-matched",
      };

      acc.processSettlement(matchedEvent);
      expect(acc.hasHold("auth-matched")).toBe(false);
      expect(acc.ledgerBalance).toBe(7000n);

      const unmatchedEvent: LedgerEvent = {
        id: "evt-settle-2",
        postedDay: 2,
        valueDay: 2,
        type: "SETTLEMENT",
        accountId: "acc-1",
        amount: 2000n,
        authId: "auth-unmatched-z",
      };

      acc.processSettlement(unmatchedEvent);
      expect(acc.ledgerBalance).toBe(5000n);
    });
  });

  describe("processEvent method", () => {
    it("handles full lifecycle of events (CREDIT, AUTHORIZATION, SETTLEMENT, REVERSAL, DEBIT)", () => {
      const acc = new Account("acc-1", 0n, "USD");

      // 1. Credit 100.00
      acc.processEvent({
        id: "e1",
        postedDay: 1,
        valueDay: 1,
        type: "CREDIT",
        accountId: "acc-1",
        amount: 10000n,
      });
      expect(acc.ledgerBalance).toBe(10000n);
      expect(acc.getAvailableBalance()).toBe(10000n);

      // 2. Auth hold 40.00
      acc.processEvent({
        id: "e2",
        postedDay: 1,
        valueDay: 1,
        type: "AUTHORIZATION",
        accountId: "acc-1",
        amount: 4000n,
        authId: "auth-1",
      });
      expect(acc.ledgerBalance).toBe(10000n);
      expect(acc.getAvailableBalance()).toBe(6000n);

      // 3. Matched Settlement 40.00
      acc.processEvent({
        id: "e3",
        postedDay: 2,
        valueDay: 2,
        type: "SETTLEMENT",
        accountId: "acc-1",
        amount: 4000n,
        authId: "auth-1",
      });
      expect(acc.ledgerBalance).toBe(6000n);
      expect(acc.getAvailableBalance()).toBe(6000n);

      // 4. Auth hold 30.00 then Reversal of hold
      acc.processEvent({
        id: "e4",
        postedDay: 2,
        valueDay: 2,
        type: "AUTHORIZATION",
        accountId: "acc-1",
        amount: 3000n,
        authId: "auth-2",
      });
      expect(acc.getAvailableBalance()).toBe(3000n);

      acc.processEvent({
        id: "e5",
        postedDay: 2,
        valueDay: 2,
        type: "REVERSAL",
        accountId: "acc-1",
        amount: 3000n,
        authId: "auth-2",
      });
      expect(acc.getAvailableBalance()).toBe(6000n);
      expect(acc.holds.has("auth-2")).toBe(false);

      // 5. Debit 10.00 directly
      acc.processEvent({
        id: "e6",
        postedDay: 3,
        valueDay: 3,
        type: "DEBIT",
        accountId: "acc-1",
        amount: 1000n,
      });
      expect(acc.ledgerBalance).toBe(5000n);
      expect(acc.getAvailableBalance()).toBe(5000n);
    });
  });

  describe("direct credit, debit and hold release methods", () => {
    it("credits and debits balance properly", () => {
      const acc = new Account("acc-1", 1000n, "USD");
      acc.processCredit(500n);
      expect(acc.ledgerBalance).toBe(1500n);

      acc.processDebit(300n);
      expect(acc.ledgerBalance).toBe(1200n);

      expect(() => acc.processCredit(-100n)).toThrow(RangeError);
      expect(() => acc.processDebit(-100n)).toThrow(RangeError);
    });

    it("releases holds via releaseHold", () => {
      const acc = new Account("acc-1", 5000n, "USD");
      acc.processAuthorization("auth-1", 2000n);
      expect(acc.releaseHold("auth-1")).toBe(true);
      expect(acc.releaseHold("auth-1")).toBe(false);
      expect(acc.getAvailableBalance()).toBe(5000n);
    });
  });
});
