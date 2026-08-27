import type { LedgerEvent } from "../types";
import { Account } from "../model/account";
import { getCurrencyDecimals, roundDivision, type RoundingMode } from "../model/money";

export interface EngineConfig {
  defaultCurrency?: string;
  interestRateBasisPoints?: number; // e.g. 4 bps = 0.04%
  dailyInterestRate?: number; // e.g. 0.0004 for 0.04%
  overdraftFeeAmount?: bigint; // Default 2500n (AED 25.00)
  overdraftFeeCurrency?: string;
  roundingMode?: RoundingMode;
}

export interface DailyAccrualRecord {
  accountId: string;
  day: number;
  closingBalance: bigint;
  interestAccrued: bigint;
}

export interface EODResult {
  day: number;
  accountId: string;
  closingBalance: bigint;
  dailyInterest: bigint;
  overdraftFeeAssessed: boolean;
  overdraftFeeEvent?: LedgerEvent | undefined;
  capitalizationEvent?: LedgerEvent | undefined;
}

/**
 * Core Ledger Engine implementing:
 * - Append-only a list of all posted ledger entries
 * - Value-date based on closing balance queries
 * - Daily interest calculation (0.04% on positive closing balance) with rounded accruals
 * - Day 5 historical overdraft check & lookback fee assessment
 * - Day 6 interest capitalization posting
 */
export class LedgerEngine {
  private readonly _entries: LedgerEvent[] = [];
  private readonly _accounts: Map<string, Account> = new Map();
  // Map<accountId, Map<day, bigint>>
  private readonly _dailyAccruals: Map<string, Map<number, bigint>> = new Map();
  // Map<accountId, Set<number>> - days for which accruals have been capitalized
  private readonly _capitalizedDays: Map<string, Set<number>> = new Map();
  // Map<accountId, boolean> - whether Day 5 overdraft fee has been assessed
  private readonly _overdraftAssessed: Map<string, boolean> = new Map();

  readonly defaultCurrency: string;
  readonly dailyInterestRate: number; // 0.0004 = 0.04%
  readonly overdraftFeeAmount: bigint; // 2500n = 25.00 AED
  readonly roundingMode: RoundingMode;

  constructor(config?: EngineConfig) {
    this.defaultCurrency = config?.defaultCurrency ?? "AED";
    this.dailyInterestRate = config?.dailyInterestRate ?? 0.0004; // 0.04% = 4 / 10,000
    this.overdraftFeeAmount = config?.overdraftFeeAmount ?? 2500n; // AED 25.00 in minor units
    this.roundingMode = config?.roundingMode ?? "HALF_EVEN";
  }

  /**
   * Registers an account with the engine.
   */
  addAccount(account: Account): void {
    if (this._accounts.has(account.id)) {
      throw new Error(`Account already exists: ${account.id}`);
    }
    this._accounts.set(account.id, account);
  }

  /**
   * Creates and registers a new account.
   */
  createAccount(id: string, initialBalance: bigint = 0n, currency: string = this.defaultCurrency): Account {
    const account = new Account(id, initialBalance, currency);
    this.addAccount(account);
    return account;
  }

  /**
   * Retrieves an account by ID.
   */
  getAccount(accountId: string): Account | undefined {
    return this._accounts.get(accountId);
  }

  /**
   * Returns all registered accounts.
   */
  getAccounts(): Account[] {
    return Array.from(this._accounts.values());
  }

  /**
   * Returns the append-only list of all posted ledger entries.
   */
  get entries(): readonly LedgerEvent[] {
    return this._entries;
  }

  /**
   * Returns copy of all posted ledger entries.
   */
  getEntries(): readonly LedgerEvent[] {
    return [...this._entries];
  }

  /**
   * Returns all posted entries for a specific account.
   */
  getEntriesForAccount(accountId: string): LedgerEvent[] {
    return this._entries.filter((e) => e.accountId === accountId);
  }

  /**
   * Posts a ledger event to the append-only journal and updates account state.
   */
  postEvent(event: LedgerEvent): boolean {
    const account = this._accounts.get(event.accountId);
    if (!account) {
      throw new Error(`Account not found: ${event.accountId}`);
    }

    const targetEvent = event.targetEventId
      ? this._entries.find((e) => e.id === event.targetEventId)
      : undefined;

    const success = account.processEvent(event, targetEvent);
    if (success) {
      this._entries.push(Object.freeze({ ...event }));
    }
    return success;
  }

  /**
   * Alias for postEvent.
   */
  postEntry(event: LedgerEvent): boolean {
    return this.postEvent(event);
  }

  /**
   * Calculates the closing balance for an account as of a given valueDay.
   * Filters entries where valueDay <= requested valueDay and sums their ledger amounts.
   *
   * @param accountId - The account identifier
   * @param valueDay - The cutoff value day (inclusive)
   */
  getClosingBalance(accountId: string, valueDay: number): bigint {
    const account = this._accounts.get(accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Filter append-only journal entries for this account where entry valueDay <= target valueDay
    const relevantEntries = this._entries.filter(
      (entry) => entry.accountId === accountId && entry.valueDay <= valueDay
    );

    let balance = account.initialBalance ?? 0n;

    for (const entry of relevantEntries) {
      switch (entry.type) {
        case "CREDIT":
          balance += entry.amount;
          break;
        case "DEBIT":
          balance -= entry.amount;
          break;
        case "SETTLEMENT":
          balance -= entry.amount;
          break;
        case "REVERSAL":
          // If reversal targets an authId, it only releases holds;
          // If reversal targets a specific event ID:
          //   - If target was CREDIT -> subtract amount (reversal of credit)
          //   - If target was DEBIT or SETTLEMENT -> add amount (reversal of debit)
          // Otherwise (legacy default) -> add amount (credit refund)
          if (!entry.authId) {
            if (entry.targetEventId) {
              const target = this._entries.find((e) => e.id === entry.targetEventId);
              if (target?.type === "CREDIT") {
                balance -= entry.amount;
              } else {
                balance += entry.amount;
              }
            } else {
              balance += entry.amount;
            }
          }
          break;
        case "AUTHORIZATION":
          // Authorizations are holds and do not impact ledger closing balance
          break;
        default:
          break;
      }
    }

    return balance;
  }

  /**
   * Calculates daily interest on positive closing ledger balance for a given day.
   * Interest Rate: 0.04% = 4 / 10,000.
   * Rounded to currency precision using configured rounding mode (default: HALF_EVEN).
   */
  calculateDailyInterest(accountId: string, valueDay: number): bigint {
    const balance = this.getClosingBalance(accountId, valueDay);
    if (balance <= 0n) {
      return 0n;
    }

    // Daily interest: 0.04% = balance * 4 / 10000 = balance * 1 / 2500
    // 0.04% = 0.0004 = 4 / 10000
    const numerator = balance * 4n;
    const denominator = 10000n;

    return roundDivision(numerator, denominator, this.roundingMode);
  }

  /**
   * Stores daily accrued interest for an account on a given day.
   */
  recordDailyAccrual(accountId: string, day: number, interest: bigint): void {
    let accountAccruals = this._dailyAccruals.get(accountId);
    if (!accountAccruals) {
      accountAccruals = new Map<number, bigint>();
      this._dailyAccruals.set(accountId, accountAccruals);
    }
    accountAccruals.set(day, interest);
  }

  /**
   * Gets accrued interest for a specific day and account.
   */
  getDailyAccrual(accountId: string, day: number): bigint {
    return this._dailyAccruals.get(accountId)?.get(day) ?? 0n;
  }

  /**
   * Gets all daily accruals for an account.
   */
  getDailyAccruals(accountId: string): Map<number, bigint> {
    return new Map(this._dailyAccruals.get(accountId) ?? []);
  }

  /**
   * Checks whether the overdraft fee has been assessed for an account.
   */
  hasAssessedOverdraftFee(accountId: string): boolean {
    return this._overdraftAssessed.get(accountId) ?? false;
  }

  /**
   * Performs Overdraft Check (Day 5):
   * Look back at historical closing balances using value_date <= d for days 1 through 4.
   * If backdated entries make any historical day (e.g. Day 2 or Day 4) negative,
   * assess AED 25.00 overdraft fee once on Day 5 (valueDay = 5).
   *
   * @returns The generated overdraft LedgerEvent if assessed, or null otherwise.
   */
  checkAndAssessOverdraftFee(accountId: string, currentDay: number = 5): LedgerEvent | null {
    if (this._overdraftAssessed.get(accountId)) {
      return null; // Already assessed once
    }

    let hasHistoricalOverdraft = false;

    // Look back at all prior days (Days 1 to currentDay - 1)
    for (let d = 1; d < currentDay; d++) {
      const historicalBal = this.getClosingBalance(accountId, d);
      if (historicalBal < 0n) {
        hasHistoricalOverdraft = true;
        break;
      }
    }

    if (hasHistoricalOverdraft) {
      const account = this._accounts.get(accountId);
      const currency = account?.currency ?? this.defaultCurrency;
      const decimals = getCurrencyDecimals(currency);
      // If fee is configured in minor units for 2 decimals (2500 = 25.00), scale according to currency
      const feeAmount = decimals === 2 ? this.overdraftFeeAmount : 25n * 10n ** BigInt(decimals);

      const feeEvent: LedgerEvent = {
        id: `OD-FEE-DAY-${currentDay}-${accountId}`,
        postedDay: currentDay,
        valueDay: currentDay,
        type: "DEBIT",
        accountId,
        amount: feeAmount,
      };

      this.postEvent(feeEvent);
      this._overdraftAssessed.set(accountId, true);
      return feeEvent;
    }

    return null;
  }

  /**
   * Performs Day 6 Interest Capitalization:
   * Sums daily rounded accruals across uncapitalized days (Days 1–5 or 1-6)
   * and posts a single CREDIT event on Day 6.
   *
   * @returns The generated capitalization LedgerEvent if interest was posted, or null.
   */
  capitalizeInterest(accountId: string, capitalizationDay: number = 6): LedgerEvent | null {
    const accountAccruals = this._dailyAccruals.get(accountId);
    if (!accountAccruals) {
      return null;
    }

    let capitalizedSet = this._capitalizedDays.get(accountId);
    if (!capitalizedSet) {
      capitalizedSet = new Set<number>();
      this._capitalizedDays.set(accountId, capitalizedSet);
    }

    let totalInterest = 0n;
    const daysToCapitalize: number[] = [];

    for (const [day, amount] of accountAccruals.entries()) {
      if (day <= capitalizationDay && !capitalizedSet.has(day)) {
        totalInterest += amount;
        daysToCapitalize.push(day);
      }
    }

    if (totalInterest > 0n) {
      const creditEvent: LedgerEvent = {
        id: `INT-CAP-DAY-${capitalizationDay}-${accountId}`,
        postedDay: capitalizationDay,
        valueDay: capitalizationDay,
        type: "CREDIT",
        accountId,
        amount: totalInterest,
      };

      this.postEvent(creditEvent);

      for (const d of daysToCapitalize) {
        capitalizedSet.add(d);
      }

      return creditEvent;
    }

    return null;
  }

  /**
   * Executes End-of-Day (EOD) Processing for a given day (Days 1–6):
   * 1. Overdraft Check (Day 5): Look back at historical closing balances using value_date <= d.
   *    If the backdated entry makes Day 2 or Day 4 negative, assess AED 25.00 overdraft fee once on Day 5.
   * 2. Day 6 Capitalization: If day === 6, sum daily rounded accruals and post a single CREDIT event on Day 6.
   * 3. Daily Interest Check: Calculate 0.04% on positive closing ledger balance, round to currency precision,
   *    and store daily accrual.
   */
  processEODForAccount(accountId: string, day: number): EODResult {
    let overdraftFeeEvent: LedgerEvent | undefined;
    let capitalizationEvent: LedgerEvent | undefined;

    // 1. Day 5 (or general lookback) Overdraft Check
    if (day === 5) {
      const fee = this.checkAndAssessOverdraftFee(accountId, day);
      if (fee) {
        overdraftFeeEvent = fee;
      }
    }

    // 2. Day 6 Interest Capitalization
    if (day === 6) {
      const cap = this.capitalizeInterest(accountId, day);
      if (cap) {
        capitalizationEvent = cap;
      }
    }

    // 3. Daily Interest Check: compute closing balance on this day and record accrual
    const closingBalance = this.getClosingBalance(accountId, day);
    const dailyInterest = this.calculateDailyInterest(accountId, day);
    this.recordDailyAccrual(accountId, day, dailyInterest);

    return {
      day,
      accountId,
      closingBalance,
      dailyInterest,
      overdraftFeeAssessed: overdraftFeeEvent !== undefined,
      overdraftFeeEvent,
      capitalizationEvent,
    };
  }

  /**
   * Executes EOD Processing for all accounts for a specific day.
   */
  processEOD(day: number): Map<string, EODResult> {
    const results = new Map<string, EODResult>();
    for (const account of this._accounts.values()) {
      results.set(account.id, this.processEODForAccount(account.id, day));
    }
    return results;
  }

  /**
   * Executes multi-day EOD simulation from startDay to endDay (e.g., Days 1 to 6).
   */
  runSimulation(startDay: number = 1, endDay: number = 6): Map<number, Map<string, EODResult>> {
    const simResults = new Map<number, Map<string, EODResult>>();
    for (let d = startDay; d <= endDay; d++) {
      simResults.set(d, this.processEOD(d));
    }
    return simResults;
  }
}

export const Engine = LedgerEngine;
