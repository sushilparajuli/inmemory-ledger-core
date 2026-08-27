import type { LedgerEvent } from "../types";

export interface AccountConfig {
  id: string;
  currency?: string;
  initialBalance?: bigint;
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class InsufficientFundsError extends AuthorizationError {
  constructor(available: bigint, requested: bigint) {
    super(`Insufficient available funds: available ${available} < requested ${requested}`);
    this.name = "InsufficientFundsError";
  }
}

export class Account {
  readonly id: string;
  readonly currency: string;
  readonly initialBalance: bigint;
  private _ledgerBalance: bigint;
  private readonly _holds: Map<string, bigint>;

  constructor(idOrConfig: string | AccountConfig, initialBalance: bigint = 0n, currency: string = "USD") {
    if (typeof idOrConfig === "object" && idOrConfig !== null) {
      if (!idOrConfig.id || idOrConfig.id.trim() === "") {
        throw new TypeError("Account ID must be a non-empty string");
      }
      this.id = idOrConfig.id;
      this.currency = idOrConfig.currency ?? currency;
      this.initialBalance = idOrConfig.initialBalance ?? 0n;
      this._ledgerBalance = this.initialBalance;
    } else {
      if (typeof idOrConfig !== "string" || idOrConfig.trim() === "") {
        throw new TypeError("Account ID must be a non-empty string");
      }
      this.id = idOrConfig;
      this.currency = currency;
      this.initialBalance = initialBalance;
      this._ledgerBalance = initialBalance;
    }

    this._holds = new Map<string, bigint>();
  }

  /**
   * Returns a current ledger balance in minor units.
   */
  get ledgerBalance(): bigint {
    return this._ledgerBalance;
  }

  /**
   * Returns current ledger balance in minor units.
   */
  getLedgerBalance(): bigint {
    return this._ledgerBalance;
  }

  /**
   * Returns map of active authorization holds: Map<authId, amount>.
   */
  get holds(): Map<string, bigint> {
    return this._holds;
  }

  /**
   * Returns map of active authorization holds.
   */
  getActiveHolds(): ReadonlyMap<string, bigint> {
    return this._holds;
  }

  /**
   * Calculates sum of all active authorization holds in minor units.
   */
  getTotalHolds(): bigint {
    let total = 0n;
    for (const amount of this._holds.values()) {
      total += amount;
    }
    return total;
  }

  /**
   * Calculates available balance:
   * Ledger Balance − ∑(Active Holds)
   */
  getAvailableBalance(): bigint {
    return this._ledgerBalance - this.getTotalHolds();
  }

  /**
   * Checks if an authorization hold exists.
   */
  hasHold(authId: string): boolean {
    return this._holds.has(authId);
  }

  /**
   * Gets the hold amount for an authorization ID.
   */
  getHold(authId: string): bigint | undefined {
    return this._holds.get(authId);
  }

  /**
   * Releases an active hold if it exists.
   */
  releaseHold(authId: string): boolean {
    return this._holds.delete(authId);
  }

  /**
   * Credit account directly (increases ledger balance).
   */
  processCredit(amount: bigint): void {
    if (amount < 0n) {
      throw new RangeError("Credit amount must be non-negative");
    }
    this._ledgerBalance += amount;
  }

  /**
   * Debit account directly (decreases ledger balance).
   */
  processDebit(amount: bigint): void {
    if (amount < 0n) {
      throw new RangeError("Debit amount must be non-negative");
    }
    this._ledgerBalance -= amount;
  }

  /**
   * Processes an AUTHORIZATION:
   * If Available Balance ≥ Hold Amount, approve hold and record in holds map; else reject.
   *
   * @returns true if hold was approved, false if rejected due to insufficient funds.
   */
  processAuthorization(authId: string, amount: bigint): boolean;
  processAuthorization(event: LedgerEvent): boolean;
  processAuthorization(authIdOrEvent: string | LedgerEvent, maybeAmount?: bigint): boolean {
    let authId: string;
    let amount: bigint;

    if (typeof authIdOrEvent === "object") {
      if (!authIdOrEvent.authId) {
        throw new Error("Authorization event must specify an authId");
      }
      authId = authIdOrEvent.authId;
      amount = authIdOrEvent.amount;
    } else {
      authId = authIdOrEvent;
      if (maybeAmount === undefined) {
        throw new Error("Amount must be specified for authorization");
      }
      amount = maybeAmount;
    }

    if (amount < 0n) {
      throw new RangeError("Authorization amount must be non-negative");
    }

    const available = this.getAvailableBalance();
    if (available >= amount) {
      this._holds.set(authId, amount);
      return true;
    }

    return false;
  }

  /**
   * Processes a SETTLEMENT:
   * If authId exists in holds → release hold, record ledger debit.
   * If authId does not exist (Auth-Z) → force ledger debit directly (Unmatched Settlement).
   */
  processSettlement(authId: string | undefined, amount: bigint): void;
  processSettlement(event: LedgerEvent): void;
  processSettlement(authIdOrEvent: string | undefined | LedgerEvent, maybeAmount?: bigint): void {
    let authId: string | undefined;
    let amount: bigint;

    if (typeof authIdOrEvent === "object" && authIdOrEvent !== null) {
      authId = authIdOrEvent.authId;
      amount = authIdOrEvent.amount;
    } else {
      authId = authIdOrEvent;
      if (maybeAmount === undefined) {
        throw new Error("Amount must be specified for settlement");
      }
      amount = maybeAmount;
    }

    if (amount < 0n) {
      throw new RangeError("Settlement amount must be non-negative");
    }

    if (authId !== undefined && this._holds.has(authId)) {
      // Matched settlement: release hold and record ledger debit
      this._holds.delete(authId);
      this._ledgerBalance -= amount;
    } else {
      // Unmatched settlement (Auth-Z): force ledger debit directly
      this._ledgerBalance -= amount;
    }
  }

  /**
   * Processes a generic LedgerEvent.
   */
  processEvent(event: LedgerEvent): boolean {
    switch (event.type) {
      case "CREDIT":
        this.processCredit(event.amount);
        return true;
      case "DEBIT":
        this.processDebit(event.amount);
        return true;
      case "AUTHORIZATION":
        return this.processAuthorization(event);
      case "SETTLEMENT":
        this.processSettlement(event);
        return true;
      case "REVERSAL":
        if (event.authId && this._holds.has(event.authId)) {
          this.releaseHold(event.authId);
          return true;
        }
        // If target event or general reversal of debit/credit
        this.processCredit(event.amount);
        return true;
      default:
        throw new Error(`Unsupported event type: ${(event as LedgerEvent).type}`);
    }
  }
}
