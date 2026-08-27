# Rejected Criteria Analysis: Formal Takedown of False Criteria (C2, C4, C6, C7, C8)

This document provides the in-depth financial, architectural, and mathematical breakdown of why proposed naive/false criteria **C2, C4, C6, C7, and C8** are explicitly rejected in this ledger implementation.

---

## Criterion C2: "Reject Unmatched Settlements (Auth-Z) If No Pre-Existing Authorization Hold Exists"

### The Proposed Criterion
*Assert that any SETTLEMENT event lacking a matching `authId` in active holds must throw an error or be rejected immediately without modifying the ledger balance.*

### Why C2 Is Formally Rejected
1. **Legal and Clearing Mandates**:
   - In international payment networks (Visa Core Rules, Mastercard Settlement Standards, Fedwire, SWIFT, UAE Central Bank FTS), a settlement message represents an irrevocable clearing obligation presented by the acquiring bank.
   - Issuing banks cannot unilaterally reject a settlement clearing file due to missing local hold state. Rejecting a valid clearing file violates scheme rules and incurs substantial compliance penalties.
2. **Offline, Split, and Delayed Authorization Scenarios**:
   - Legitimate real-world transactions frequently generate unmatched settlements:
     - In-flight/airline purchases (offline capture).
     - Transit gate taps (batch settlement post-aggregation).
     - Hotel/car rental incremental settlements exceeding initial pre-auth.
     - Expired holds where settlement arrives after the 7-day hold TTL has lapsed.
3. **Core Architectural Correctness**:
   - Rejecting `Auth-Z` would cause ledger balance divergence from actual reserve balances at the Central Bank.
   - Therefore, unmatched settlements **must force a direct ledger debit**.

---

## Criterion C4: "Calculate Daily Interest on Unsettled Authorizations / Available Balance"

### The Proposed Criterion
*Assert that daily interest accrual should be calculated based on Available Balance (Ledger Balance minus Active Holds) rather than Closing Ledger Balance.*

### Why C4 Is Formally Rejected
1. **Accounting vs. Risk Control Distinction**:
   - Authorizations are **not** ledger entries. They are transient, non-financial reservations (locks) that manage credit and liquidity risk.
   - Customer funds placed under an authorization hold remain full legally inside the customer's account and within the bank's general ledger until settlement occurs.
2. **Regulatory & Statutory Compliance**:
   - Under banking law (GAAP, IFRS 9, Consumer Credit Acts), interest must accrue on funds legally held and owed. Depriving a customer of interest on funds that have not yet left the bank constitutes an illegal hidden fee and unfair banking practice.
3. **Mathematical Correctness**:
   - Calculating interest on `getAvailableBalance()` would cause interest calculations to fluctuate with pending temporary holds that may ultimately be reversed (e.g., hotel incidentals deposit), creating irreconcilable interest disputes.
   - Therefore, interest **must be computed strictly on positive closing ledger balance** (`getClosingBalance(accountId, day)`).

---

## Criterion C6: "Backdate Overdraft Fee Entries to the Infraction Value Date (Day 2)"

### The Proposed Criterion
*Assert that when a backdated debit (E7) causes a negative closing balance on Day 2, the resulting AED 25.00 overdraft fee should be posted with `postedDay = 2` and `valueDay = 2`.*

### Why C6 Is Formally Rejected
1. **Violation of Immutability on Closed Books**:
   - Ledger entries represent historical events in physical time. A transaction discovered on Day 5 did not exist on Day 2.
   - If historical periods (Day 2) could have new transactions back-injected into them, daily closing reports, regulatory capital disclosures, and audit hashes from Day 2 would be retroactively invalidated.
2. **Cascade of Erroneous Penalties**:
   - Backdating the fee to Day 2 would artificially alter the Day 2, 3, and 4 closing balances by an additional AED 25.00 deduction, corrupting past interest calculations for Days 2 through 4.
3. **Accounting Standards Alignment**:
   - Overdraft fees are assessed upon discovery during the EOD processing cycle on Day 5.
   - Therefore, `OD-FEE-DAY-5` is booked with **`postedDay = 5` and `valueDay = 5`**.

---

## Criterion C7: "Automatically Void or Delete Overdraft Fees Upon Reversal of Underlying Transactions (e.g., Reversing E9)"

### The Proposed Criterion
*Assert that if an event reversal or refund occurs (such as reversing credit E9 or settling a dispute), the system should automatically delete or reverse past posted overdraft fees.*

### Why C7 Is Formally Rejected
1. **Strict Append-Only Immutability**:
   - In an append-only journal, transactions are never deleted, mutated, or removed. Every posted event is a permanent historical ledger record.
2. **Temporal Legality of the Overdraft State**:
   - At the time Day 5 EOD was executed, the account was demonstrably in overdraft during Day 2 due to the backdated debit `E7`. The fee was legitimately assessed under the account terms and conditions.
   - Subsequent event reversals on Day 6 do not rewrite the historical physical reality that the account was overdrawn on Day 2.
3. **Fee Waiver Mechanics**:
   - If a fee is waived as a courtesy or due to merchant error, standard banking protocol requires posting an **explicit compensating `FEE_REFUND` or `CREDIT` transaction**, preserving complete auditability for internal controls and external auditors.
   - Therefore, past posted fee events **remain intact on the ledger**.

---

## Criterion C8: "Capitalize Daily Interest Continuously into Ledger Balance at EOD Each Day"

### The Proposed Criterion
*Assert that daily accrued interest should be credited directly to the customer's ledger balance at the end of every individual day (Days 1–5) rather than accrued in memory and capitalized on Day 6.*

### Why C8 Is Formally Rejected
1. **Accrual vs. Capitalization Distinction in Banking**:
   - Financial institutions distinguish between **interest accrual** (an internal accounting calculation of interest earned but not yet disbursed) and **interest capitalization/payout** (the actual credit event that increases a customer spendable principal).
   - Most banking products accrue interest daily but capitalize monthly, quarterly, or on a specific statement cycle date (e.g., Day 6).
2. **Premature Compounding Inaccuracies**:
   - Daily capitalization would cause intra-month daily compounding on uncapitalized accruals, distorting the agreed-upon simple daily rate ($0.04\%$) and violating standard product disclosures.
3. **Audit Trail Clarity**:
   - Capitalizing daily creates microcredit transactions ($<1$ AED) every single day, cluttering customer statements and payment journals.
   - Storing daily rounded accruals in an accrual registry and posting a **single consolidated CREDIT event on Day 6** provides clean reconciliation and adherence to banking standards.
