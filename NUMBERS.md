# Constants & Numeric Decisions (NUMBERS.md)

This document details every numeric constant, scaling parameter, and default value chosen across the codebase, along with the engineering/mathematical rationale for each value and why choosing half of that value is unacceptable or mathematically invalid.

---

### 1. Default Currency Decimals (`2`)
- **Code Location**: `src/model/money.ts` (`CURRENCY_DECIMALS`, `getCurrencyDecimals` fallback)
- **Chosen Value**: `2`
- **Why this value?**
  - Standard international currencies under ISO 4217 (USD, EUR, GBP, AED, SAR, INR, etc.) use 2 decimal places ($10^2 = 100$ minor units per 1 major unit, e.g., 100 cents = 1 USD, 100 fils = 1 AED).
  - 2 decimals is the global standard fallback for financial systems.
- **Why not half it (1 decimal place)?**
  - Halving to 1 decimal place gives a scaling factor of $10^1 = 10$.
  - This would represent monetary values in tenths of a unit (e.g. 10 cents = 1 USD). Any transaction with fractional cents (e.g. $1.99 or $0.25) cannot be stored as an integer and would be truncated to $1.9 or $0.2, immediately causing severe ledger leakage and 90% rounding distortion on sub-dollar amounts.

---

### 2. Zero-Decimal Currencies (`0`)
- **Code Location**: `src/model/money.ts` (`JPY`, `KRW`, `UGX`, `VND`, `CLP`, etc. in `CURRENCY_DECIMALS`)
- **Chosen Value**: `0`
- **Why this value?**
  - ISO 4217 specifies that zero-decimal currencies (e.g. Japanese Yen `JPY`, South Korean Won `KRW`) have no fractional subunit in modern circulation ($10^0 = 1$ minor unit per major unit).
- **Why not half it (0.5 or fractional exponent)?**
  - Halving 0 to a negative value or attempting a fractional power $10^{0.5} \approx 3.162277$ is mathematically impossible for integer minor units (irrational multiplier).
  - Fractional minor units would require floating-point calculations, breaking the strict integer invariant of the ledger.

---

### 3. Three-Decimal Currencies (`3`)
- **Code Location**: `src/model/money.ts` (`BHD`, `KWD`, `OMR`, `JOD`, `IQD`, `TND`, `LYD` in `CURRENCY_DECIMALS`)
- **Chosen Value**: `3`
- **Why this value?**
  - Middle Eastern dinars and rials (e.g. Bahraini Dinar `BHD`, Kuwaiti Dinar `KWD`, Omani Rial `OMR`) strictly divide into 1,000 fils/baisa ($10^3 = 1,000$ minor units per 1 major unit).
  - 10.000 BHD = 10,000 minor units.
- **Why not half it (1.5 decimals)?**
  - A decimal exponent of 1.5 yields an irrational scaling factor of $10^{1.5} \approx 31.62277$, which destroys base-10 positional notation.
  - Rounding down to 1 or 2 decimals would make it impossible to represent 1 fils ($0.001$ BHD), corrupting all pricing, tax, and FX settlement in those jurisdictions.

---

### 4. Four-Decimal Currencies (`4`)
- **Code Location**: `src/model/money.ts` (`CLF`, `UYW` in `CURRENCY_DECIMALS`)
- **Chosen Value**: `4`
- **Why this value?**
  - Financial indexing units like Chilean Unidad de Fomento (`CLF`) and Uruguayan Unidad Previsional (`UYW`) are regulated by central banks to track inflation up to 4 decimal places ($10^4 = 10,000$ minor units per unit).
- **Why not half it (2 decimals)?**
  - Halving to 2 decimals truncates precision by a factor of 100 ($10^2$ vs $10^4$).
  - This would render financial bonds, mortgages, and inflation-indexed contracts completely inaccurate and non-compliant with central bank clearing requirements.

---

### 5. Decimal Scale Base (`10n`)
- **Code Location**: `src/model/money.ts` (`10n ** BigInt(decimals)`)
- **Chosen Value**: `10n`
- **Why this value?**
  - The international monetary system is strictly decimal (base 10).
- **Why not half it (5n)?**
  - A base-5 scale would represent powers of 5 ($5^1 = 5, 5^2 = 25, 5^3 = 125$), which cannot represent standard decimal fractions (e.g., $0.10, $0.01) as clean integer values.

---

### 6. Half-Rounding Multiplier (`2n`)
- **Code Location**: `src/model/money.ts` (`const doubleRemainder = absRemainder * 2n;` in `roundDivision`)
- **Chosen Value**: `2n`
- **Why this value?**
  - To determine whether a remainder $r$ reaches or exceeds the midpoint of divisor $d$ ($r/d \ge 1/2$), integer arithmetic multiplies by 2 ($2r \ge d$).
  - This avoids floating-point operations, division truncation, and precision drift.
- **Why not half it (1n)?**
  - If the multiplier were $1n$, the check would be $1 \times r \ge d$, which only triggers when remainder equals or exceeds the full denominator $d$.
  - Since the modulo remainder $r$ is always strictly less than $d$ ($r < d$), the condition would never trigger, completely breaking half-up, half-down, and Banker's rounding (turning them all into truncation/round-down).

---

### 7. Parity Modulo (`2n`) for Banker's Rounding
- **Code Location**: `src/model/money.ts` (`if (absQuotient % 2n === 1n)` in `roundDivision`)
- **Chosen Value**: `2n`
- **Why this value?**
  - In number theory, parity (even vs. odd) is strictly defined by division modulo 2: $x \pmod 2 \equiv 0$ is even, $x \pmod 2 \equiv 1$ is odd.
  - Banker's rounding (round-to-nearest-even / IEEE 754 standard) requires identifying whether the integer quotient is odd to break exact-half ties toward the nearest even integer.
- **Why not half it (1n)?**
  - In integer arithmetic, $x \pmod 1 \equiv 0$ for all integers $x \in \mathbb{Z}$.
  - Using modulo 1 would evaluate all numbers as even (0 remainder), meaning odd numbers would never be rounded to the nearest even number, defeating the purpose of Banker's rounding to eliminate statistical upward bias.

---

### 8. Initial Account Balance Default (`0n`)
- **Code Location**: `src/model/account.ts` (`initialBalance: bigint = 0n`)
- **Chosen Value**: `0n`
- **Why this value?**
  - Double-entry and ledger conservation principles dictate that newly created accounts start with zero funds unless funded by a distinct credit/deposit event.
- **Why not half it?**
  - Zero is symmetric and neutral ($0 / 2 = 0$). Any non-zero default creates phantom money or phantom liabilities out of thin air, violating balance sheet equilibrium.

---

### 9. Thousands Digit Grouping in Formatter (`3`)
- **Code Location**: `src/model/money.ts` (`\B(?=(\d{3})+(?!\d))` in `format()`)
- **Chosen Value**: `3`
- **Why this value?**
  - Western financial and ISO notation groups major units into thousands ($10^3 = 1,000$), millions ($10^6$), and billions ($10^9$).
- **Why not half it (1.5 or 2)?**
  - 1.5 digits grouping is syntactically invalid in regex character grouping.
  - 2 digits grouping is used in the South Asian numbering system (lakh/crore) for numbers above 1,000, but is not standard for universal multi-currency international ledgers (e.g., $100,000 vs ₹1,00,000).
