import { describe, expect, it } from "vitest";
import { LedgerEngine } from "./core/engine";
import type { LedgerEvent } from "./types";

describe("Domain Invariant: Event Reversals vs Immutable Fee Assessment", () => {
  it("asserts that reversing an event (E9) does NOT undo past posted overdraft fees", () => {
    // --------------------------------------------------------------------------------------------------
    // DOMAIN INVARIANT:
    // In financial accounting and immutable double-entry ledger architecture, once a fee (such as an
    // overdraft penalty or late fee) is assessed and posted as a valid ledger transaction, it becomes
    // an immutable, permanent historical fact on the ledger journal.
    //
    // Reversing, cancelling, or voiding an underlying commercial transaction (e.g., reversing credit E9)
    // or mutating future account state DOES NOT automatically or retroactively unpost or erase previously
    // posted fee entries from the ledger.
    //
    // If a financial institution decides to waive or return a fee due to dispute resolution or operational
    // remediation, this MUST be represented explicitly as a new, separate compensating transaction
    // (e.g., FEE_REFUND or CREDIT event) rather than mutating historical transaction history or silently
    // reversing the original fee entry.
    // --------------------------------------------------------------------------------------------------

    const engine = new LedgerEngine({
      defaultCurrency: "AED",
      overdraftFeeAmount: 2500n, // AED 25.00
    });
    const account = engine.createAccount("ACC-001", 0n, "AED");

    // Day 1: Credit AED 1,000.00 (E1)
    const e1: LedgerEvent = {
      id: "E1",
      postedDay: 1,
      valueDay: 1,
      type: "CREDIT",
      accountId: "ACC-001",
      amount: 100000n, // AED 1,000.00
    };
    engine.postEvent(e1);
    expect(engine.getClosingBalance("ACC-001", 1)).toBe(100000n);

    // Day 2: Matched Settlement AED 300.00 (E3) -> Balance becomes AED 700.00
    const e3: LedgerEvent = {
      id: "E3",
      postedDay: 2,
      valueDay: 2,
      type: "SETTLEMENT",
      accountId: "ACC-001",
      amount: 30000n, // AED 300.00
      authId: "AUTH-101",
    };
    engine.postEvent(e3);
    expect(engine.getClosingBalance("ACC-001", 2)).toBe(70000n);

    // Day 4: Unmatched Settlement AED 150.00 (E8 Auth-Z) -> Balance becomes AED 550.00
    const e8: LedgerEvent = {
      id: "E8",
      postedDay: 4,
      valueDay: 4,
      type: "SETTLEMENT",
      accountId: "ACC-001",
      amount: 15000n, // AED 150.00
      authId: "AUTH-Z",
    };
    engine.postEvent(e8);

    // Day 4: Credit AED 500.00 (E9) -> Balance becomes AED 1,050.00
    const e9: LedgerEvent = {
      id: "E9",
      postedDay: 4,
      valueDay: 4,
      type: "CREDIT",
      accountId: "ACC-001",
      amount: 50000n, // AED 500.00
    };
    engine.postEvent(e9);
    expect(engine.getClosingBalance("ACC-001", 4)).toBe(105000n);

    // Day 5: Backdated Debit AED 750.00 (E7) posted on Day 5 with valueDay = 2
    // Retroactive Day 2 closing balance becomes: 1000.00 - 300.00 - 750.00 = (-AED 50.00) (Negative!)
    const e7: LedgerEvent = {
      id: "E7",
      postedDay: 5,
      valueDay: 2,
      type: "DEBIT",
      accountId: "ACC-001",
      amount: 75000n, // AED 750.00
    };
    engine.postEvent(e7);

    // Verify retroactive negative closing balance on Day 2
    expect(engine.getClosingBalance("ACC-001", 2)).toBe(-5000n);

    // Day 5 End-of-Day Overdraft check assesses AED 25.00 fee
    const feeEvent = engine.checkAndAssessOverdraftFee("ACC-001", 5);
    expect(feeEvent).not.toBeNull();
    expect(feeEvent?.type).toBe("DEBIT");
    expect(feeEvent?.amount).toBe(2500n); // AED 25.00
    expect(feeEvent?.postedDay).toBe(5);
    expect(feeEvent?.valueDay).toBe(5);

    // Verify fee is posted to ledger entries and account balance reflects fee debit
    const entriesBeforeReversalCount = engine.entries.length;
    const feeEntryExists = engine.entries.some((entry) => entry.id === feeEvent?.id);
    expect(feeEntryExists).toBe(true);

    // Ledger balance at Day 5 includes fee: 1050.00 - 750.00 - 25.00 = AED 275.00 (27500n)
    expect(engine.getClosingBalance("ACC-001", 5)).toBe(27500n);
    expect(account.ledgerBalance).toBe(27500n);

    // --------------------------------------------------------------------------------------------------
    // EVENT REVERSAL / CANCELLATION:
    // Now reverse/compensate the credit event E9 (e.g., E9 was fraudulent, charged back, or posted in error)
    // by posting a REVERSAL targeting E9.
    // --------------------------------------------------------------------------------------------------
    const e9Reversal: LedgerEvent = {
      id: "E9-REV",
      postedDay: 6,
      valueDay: 4, // Reversal effective from valueDay 4
      type: "REVERSAL",
      accountId: "ACC-001",
      amount: 50000n, // Reverses AED 500.00 credit
      targetEventId: "E9",
    };
    engine.postEvent(e9Reversal);

    // --------------------------------------------------------------------------------------------------
    // DOMAIN INVARIANT ASSERTIONS:
    // 1. The original overdraft fee event is STILL present in the append-only ledger journal.
    // 2. The fee was NOT deleted, erased, or removed from the ledger.
    // 3. The historical fee assessment state remains intact (`hasAssessedOverdraftFee` is still true).
    // 4. Ledger closing balance reflects both the original fee deduction AND the reversal debit.
    // --------------------------------------------------------------------------------------------------
    expect(engine.entries.length).toBe(entriesBeforeReversalCount + 1);

    // Overdraft fee event is permanently preserved in the ledger entries
    const feeEntryAfterReversal = engine.entries.find((entry) => entry.id === feeEvent?.id);
    expect(feeEntryAfterReversal).toBeDefined();
    expect(feeEntryAfterReversal?.type).toBe("DEBIT");
    expect(feeEntryAfterReversal?.amount).toBe(2500n);
    expect(feeEntryAfterReversal?.postedDay).toBe(5);

    // Engine records that overdraft fee was assessed and was not rolled back
    expect(engine.hasAssessedOverdraftFee("ACC-001")).toBe(true);

    // Balance after reversing E9 (500.00 credit):
    // Prior balance (275.00) - 500.00 = -225.00 (-22500n)
    // Note: The -25.00 overdraft fee remains deducted!
    expect(engine.getClosingBalance("ACC-001", 6)).toBe(-22500n);
    expect(account.ledgerBalance).toBe(-22500n);
  });
});
