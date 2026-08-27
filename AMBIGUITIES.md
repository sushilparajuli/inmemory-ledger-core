# Ambiguities & Resolution Analysis

This document analyzes and resolves key architectural ambiguities within the in-memory ledger engine:
1. **Auth-Z (Unmatched Settlement) Forced Posting**
2. **E10 Day 5 vs. Replay Order & EOD Processing Sequence**
3. **Overdraft Fee Booking Date (Posted Date vs. Value Date vs. Effective Accrual)**

---

## 1. Auth-Z Forced Post (Unmatched Settlement)

### The Ambiguity
In credit card and interbank settlement processing (e.g., Visa, Mastercard, ISO 8583 / ISO 20022), a settlement event is normally preceded by an authorization hold (`AUTHORIZATION` $\rightarrow$ `SETTLEMENT`). However, settlement messages often arrive without a pre-existing matching authorization hold (referred to as **Auth-Z**, forced debit, late settlement, or unmatched settlement). 

The ambiguity arises regarding whether an unmatched settlement:
- Should be **rejected** due to the absence of a hold or insufficient available balance, or
- Must be **forced through** as a direct ledger debit regardless of account balance or hold existence.

### Resolution & Domain Invariant
In retail and commercial banking protocols, payment scheme settlement messages are **clearing guarantees and legally binding financial obligations**. An acquiring/issuing bank cannot reject a settlement presenting a cleared cardholder charge simply because an authorization was missing, expired, dropped from memory, or mismatched in terminal ID.

**Resolution Policy**:
- When `Account.processSettlement(event)` receives a settlement with an `authId` not present in `_holds` (or where `authId` is null/unmatched):
  1. The system **does not reject** the settlement.
  2. The system forces a direct debit to the `_ledgerBalance` (`_ledgerBalance -= amount`).
  3. The `_holds` map remains untouched (no hold to release).
- Unmatched settlements can legitimately push available and ledger balances below zero, as scheme clearing takes precedence over credit limits.

---

## 2. E10 Day 5 vs. Replay Order (Intra-Day Event Arrival vs. EOD Batch)

### The Ambiguity
On Day 5, multiple operations occur:
- Backdated Debit `E7` arrives (posted on Day 5, with value date Day 2).
- Authorization `E10` arrives on Day 5 (requesting an authorization hold of AED 100.00).
- End-of-Day (EOD) processing executes (retroactive overdraft detection, fee assessment, and daily interest calculation).

The ambiguity lies in the intraday arrival ordering:
- Does EOD batch processing execute before or after intraday authorizations/transactions?
- Does the Day 5 overdraft fee debit impact the available balance during `E10`'s authorization evaluation?

### Resolution & Domain Invariant
Intraday transactions occur during operating hours, whereas End-of-Day (EOD) accounting sweeps run at close of business (COB / cutoff):

1. **Intra-Day Stream**:
   - `E7` (backdated debit of AED 750.00) is posted first during Day 5 operations.
   - `E10` (authorization hold of AED 100.00) is evaluated next against the real-time available balance.
   - At the time `E10` is evaluated, the account ledger balance is AED 300.00 (AED 1,050.00 - AED 750.00), holds are AED 0.00, so an available balance is AED 300.00 $\ge$ AED 100.00. Therefore, `E10` is **approved**, locking an AED 100.00 hold and reducing an available balance to AED 200.00.
2. **End-of-Day (EOD) Sweep**:
   - EOD runs at the close of Day 5 after all intraday client events have completed.
   - The overdraft lookback check observes that Day 2 had a retroactive negative balance of (-AED 50.00) due to `E7`.
   - The engine generates and posts the overdraft fee event `OD-FEE-DAY-5` (debit of AED 25.00).
   - This fee reduces the Day 5 closing balance to AED 275.00 and an available balance to AED 175.00.
3. **Replay Determinism**:
   - Processing events sequentially in natural arrival order (`E1` $\rightarrow \dots \rightarrow$ `E10`) followed by `processEODForAccount(day)` per day guarantees exact, reproducible real-time and end-of-day balances.

---

## 3. Overdraft Fee Booking Date

### The Ambiguity
When a backdated transaction (such as `E7` with value date Day 2 posted on Day 5) causes a retroactive overdraft in a past accounting period, should the resulting overdraft fee be:
- **Backdated** to the value date of the infraction (Day 2), or
- **Booked on the current discovery date** (Day 5) with both `postedDay = 5` and `valueDay = 5`?

### Resolution & Domain Invariant
In regulatory banking practice (e.g., Basel III, GAAP/IFRS, and Central Bank regulations):
- **No Retroactive Fee Assessment on Closed Books**: You cannot backdate a fee into a closed prior accounting period because financial statements, regulatory capital ratios, and historical tax filings for that closed day have already been signed off.
- **Value Date Alignment**: Assessing a fee with `valueDay = 5` ensures that interest accrual penalties for the fee itself only begin on Day 5, preventing cascading compounding penalties on prior days.

**Resolution Policy**:
- When historical overdraft lookback discovers a breach on Day 2 during Day 5 EOD sweeps:
  - `feeEvent.postedDay = 5` (Transaction timestamp of discovery).
  - `feeEvent.valueDay = 5` (Effective accounting value date for balances and subsequent interest).
  - The fee is posted as an immutable debit entry and cannot be retroactively cancelled by subsequent transaction reversals.
