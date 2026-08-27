# In-Memory Core Ledger Engine

A deterministic, append-only, immutable in-memory banking ledger engine built in TypeScript. Designed with financial rigor, exact integer minor-unit arithmetic, authorization lifecycle management, value-dated balance tracking, retroactive overdraft detection, and daily interest accrual/capitalization.

---

## 📌 Features & Architecture

- **Strict Minor-Unit Integer Arithmetic (`src/model/money.ts`)**:
  - All currency amounts are represented strictly as `bigint` minor units (e.g., `120000n` = AED 1,200.00; `10000n` = BHD 10.000).
  - Configurable multi-currency precision (0 decimals for JPY, 2 for AED/USD, 3 for BHD/KWD, 4 for CLF).
  - Banker's rounding (`HALF_EVEN`) and largest-remainder distribution (`split`, `allocate`) guaranteeing zero minor-unit loss.
- **Account & Authorization Lifecycle (`src/model/account.ts`)**:
  - Dual-balance architecture:
    $$\text{Available Balance} = \text{Ledger Balance} - \sum(\text{Active Holds})$$
  - Real-time authorization hold placement, available balance validation, and hold release on settlement.
  - Full support for **Unmatched Settlements (Auth-Z)**: scheme-mandated forced direct ledger debits without prior holds.
  - Active hold reversals restoring available funds without ledger pollution.
- **Append-Only Core Ledger Engine (`src/core/engine.ts`)**:
  - Immutable transaction journal preserving complete physical audit history.
  - Point-in-time and value-dated balance calculations (`getClosingBalance(accountId, valueDay)`).
  - **Retroactive Overdraft Detection (Day 5)**: Backdated transactions (e.g., `E7` with value date Day 2 posted on Day 5) triggering a single AED 25.00 overdraft fee booked on the discovery date (`valueDay = 5`).
  - **Daily Interest Accrual**: Daily calculation of $0.04\%$ on positive closing ledger balances using Banker's rounding.
  - **Interest Capitalization (Day 6)**: Aggregates daily rounded accruals into a single `CREDIT` event.
- **Sequential Replay & Daily Reporting Table (`src/index.ts`)**:
  - Replays events `E1` through `E10` across Days 1–6.
  - Generates an aligned daily report table tracking Closing Balances, Available Balances, Fee Assessments, Authorization States, and Errors/Rejections.

---

## 📂 Project Structure

```
├── src/
│   ├── core/
│   │   ├── engine.ts           # Core ledger engine, EOD sweeps, interest & fees
│   │   └── engine.test.ts      # Engine unit tests
│   ├── model/
│   │   ├── account.ts          # Account balance & authorization hold state machine
│   │   ├── account.test.ts     # Account lifecycle unit tests
│   │   ├── money.ts            # BigInt minor-unit currency arithmetic & allocation
│   │   └── money.test.ts       # Money & allocation unit tests
│   ├── types/
│   │   ├── index.ts            # Immutable event interfaces (CREDIT, DEBIT, AUTHORIZATION, SETTLEMENT, REVERSAL)
│   │   └── index.test.ts       # Type verification tests
│   ├── index.ts                # Main execution entrypoint, event sequence & report table
│   └── index.test.ts           # Integration tests for replay & table output
├── tests/
│   └── failing_annotated.test.ts # Domain invariant test (reversals do NOT delete past fees)
├── AMBIGUITIES.md              # Rationale on Auth-Z, E10 ordering & fee booking dates
├── REJECTED.md                 # Formal takedown of false criteria (C2, C4, C6, C7, C8)
├── NUMBERS.md                  # Mathematical rationale for all numeric constants
├── WORKLOG.md                  # Timestamped audit log of all development milestones
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Run the Event Replay Simulation & Daily Report Table
```bash
npm start
```
This executes the sequential replay of events `E1` through `E10` and prints the multi-day daily report table for Days 1–6:

```
+-----+-----------------+-------------------+------------------+---------------------+-------------------+
| Day | Closing Balance | Available Balance | Fee Assessments  | Active Holds State  | Errors/Rejections |
+-----+-----------------+-------------------+------------------+---------------------+-------------------+
| 1   | AED 1,000.00    | AED 700.00        | -                | AUTH-101: 300.00    | -                 |
| 2   | AED 700.00      | AED 500.00        | -                | AUTH-103: 200.00    | E4: Insufficient  |
| 3   | AED 700.00      | AED 700.00        | -                | (None)              | -                 |
| 4   | AED 1,050.00    | AED 1,050.00      | -                | (None)              | -                 |
| 5   | AED 275.00      | AED 175.00        | OD-FEE: AED 25.00| AUTH-104: 100.00    | -                 |
| 6   | AED 276.12      | AED 176.12        | -                | AUTH-104: 100.00    | -                 |
+-----+-----------------+-------------------+------------------+---------------------+-------------------+
```

### 3. Run Test Suite
```bash
npm test
# Or with vitest directly:
npx vitest run
```

### 4. Code Linting & TypeScript Build
```bash
npm run lint
npm run build
```


## 🏛 Domain Specifications & Documentation

| Document | Description |
| :--- | :--- |
| **[AMBIGUITIES.md](./AMBIGUITIES.md)** | Technical analysis resolving Auth-Z forced debits, Day 5 E10 replay ordering vs EOD batch sweeps, and value-date alignment for overdraft fees. |
| **[REJECTED.md](./REJECTED.md)** | Rigorous mathematical and banking takedowns refusing false criteria (C2, C4, C6, C7, C8). |
| **[NUMBERS.md](./NUMBERS.md)** | Justification for every numeric constant (minor-unit scales, division rounding, fee amounts, interest rates) and mathematical proof of why halving them fails. |
| **[WORKLOG.md](./WORKLOG.md)** | Timestamped development log detailing every milestone and verification step. |

---

## 🛡 Domain Invariants Enforced

1. **Conservation of Money**: Allocations and multi-way splits use largest-remainder distribution ensuring $\sum \text{parts} \equiv \text{total}$ with zero lost minor units.
2. **Immutable Append-Only History**: Once an event (including overdraft fees) is booked, it is never mutated or erased from the ledger. Reversals create new compensating entries.
3. **Unmatched Settlement Clearing Guarantee (Auth-Z)**: Scheme settlement clearing files are legally binding and directly debited regardless of prior authorization existence.
4. **Interest on Legal Ownership**: Daily interest accrues on physical closing ledger balances, never on transient authorization holds.
5. **Value-Date Fee Posting**: Historical overdrafts discovered via backdated transactions are booked with `postedDay = discoveryDay` and `valueDay = discoveryDay` to prevent illegal historical balance restatements.
