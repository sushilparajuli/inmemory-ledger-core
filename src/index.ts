export * from "./types";
export * from "./model/money";
export * from "./model/account";
export * from "./core/engine";

import type { LedgerEvent } from "./types";
import { LedgerEngine } from "./core/engine";
import { money } from "./model/money";

/**
 * Standard test sequence of 10 events (E1 through E10) covering:
 * - Direct Credits and Debits
 * - Authorization holds and Available Balance checks
 * - Matched Settlements (releasing holds)
 * - Authorization Rejections (insufficient funds)
 * - Active Hold Reversals
 * - Backdated Debit (E7) inducing retroactive overdraft on Day 2
 * - Unmatched Settlements (Auth-Z direct debit)
 */
export const DEFAULT_EVENTS: readonly LedgerEvent[] = Object.freeze([
  // Day 1: Initial Credit AED 1,000.00
  {
    id: "E1",
    postedDay: 1,
    valueDay: 1,
    type: "CREDIT",
    accountId: "ACC-001",
    amount: 100000n, // AED 1,000.00
  },
  // Day 1: Authorization AED 300.00 (AUTH-101) -> Approved (Available = AED 700.00)
  {
    id: "E2",
    postedDay: 1,
    valueDay: 1,
    type: "AUTHORIZATION",
    accountId: "ACC-001",
    amount: 30000n, // AED 300.00
    authId: "AUTH-101",
  },
  // Day 2: Matched Settlement AED 300.00 (AUTH-101) -> Releases hold, debits ledger to AED 700.00
  {
    id: "E3",
    postedDay: 2,
    valueDay: 2,
    type: "SETTLEMENT",
    accountId: "ACC-001",
    amount: 30000n, // AED 300.00
    authId: "AUTH-101",
  },
  // Day 2: Authorization AED 800.00 (AUTH-102) -> Rejected (Available is 700.00 < 800.00)
  {
    id: "E4",
    postedDay: 2,
    valueDay: 2,
    type: "AUTHORIZATION",
    accountId: "ACC-001",
    amount: 80000n, // AED 800.00
    authId: "AUTH-102",
  },
  // Day 2: Authorization AED 200.00 (AUTH-103) -> Approved (Hold = AED 200.00, Available = AED 500.00)
  {
    id: "E5",
    postedDay: 2,
    valueDay: 2,
    type: "AUTHORIZATION",
    accountId: "ACC-001",
    amount: 20000n, // AED 200.00
    authId: "AUTH-103",
  },
  // Day 3: Reversal AED 200.00 (AUTH-103) -> Releases hold (Available restored to AED 700.00)
  {
    id: "E6",
    postedDay: 3,
    valueDay: 3,
    type: "REVERSAL",
    accountId: "ACC-001",
    amount: 20000n, // AED 200.00
    authId: "AUTH-103",
  },
  // Day 4: Unmatched Settlement AED 150.00 (AUTH-Z) -> Forced direct debit to AED 550.00
  {
    id: "E8",
    postedDay: 4,
    valueDay: 4,
    type: "SETTLEMENT",
    accountId: "ACC-001",
    amount: 15000n, // AED 150.00
    authId: "AUTH-Z",
  },
  // Day 4: Credit AED 500.00 -> Increases ledger balance to AED 1,050.00
  {
    id: "E9",
    postedDay: 4,
    valueDay: 4,
    type: "CREDIT",
    accountId: "ACC-001",
    amount: 50000n, // AED 500.00
  },
  // Day 5: Backdated Debit E7 AED 750.00 posted on Day 5 with valueDay = 2 (causes Day 2 negative closing balance)
  {
    id: "E7",
    postedDay: 5,
    valueDay: 2,
    type: "DEBIT",
    accountId: "ACC-001",
    amount: 75000n, // AED 750.00
  },
  // Day 5: Authorization AED 100.00 (AUTH-104) -> Approved
  {
    id: "E10",
    postedDay: 5,
    valueDay: 5,
    type: "AUTHORIZATION",
    accountId: "ACC-001",
    amount: 10000n, // AED 100.00
    authId: "AUTH-104",
  },
]);

export interface DailyReportRow {
  day: number;
  closingBalance: bigint;
  availableBalance: bigint;
  dailyInterest: bigint;
  feeAssessments: string;
  authorizationStates: string;
  errorsRejections: string;
  capitalizationInfo?: string | undefined;
}

export interface ReplayOptions {
  accountId?: string;
  initialBalance?: bigint;
  currency?: string;
  totalDays?: number;
}

export interface ReplayResult {
  engine: LedgerEngine;
  accountId: string;
  currency: string;
  dailyReports: DailyReportRow[];
  eventsProcessed: LedgerEvent[];
  rejections: { event: LedgerEvent; reason: string }[];
}

/**
 * Replays events E1 through E10 sequentially across Days 1 to 6 and computes daily report metrics.
 */
export function replayEvents(
  events: readonly LedgerEvent[] = DEFAULT_EVENTS,
  options?: ReplayOptions
): ReplayResult {
  const accountId = options?.accountId ?? "ACC-001";
  const currency = options?.currency ?? "AED";
  const initialBalance = options?.initialBalance ?? 0n;
  const totalDays = options?.totalDays ?? 6;

  const engine = new LedgerEngine({ defaultCurrency: currency });
  const account = engine.createAccount(accountId, initialBalance, currency);

  const dailyReports: DailyReportRow[] = [];
  const eventsProcessed: LedgerEvent[] = [];
  const rejections: { event: LedgerEvent; reason: string }[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const dayRejections: string[] = [];

    // 1. Post all events scheduled for postedDay === day in their sequential order
    const dayEvents = events.filter((e) => e.postedDay === day);
    for (const event of dayEvents) {
      try {
        const success = engine.postEvent(event);
        if (success) {
          eventsProcessed.push(event);
        } else {
          // Rejection handled by Account (e.g., authorization exceeding available balance)
          const reason = `Authorization rejected for ${event.id} (requested ${money(event.amount, currency).format()}, available ${money(account.getAvailableBalance(), currency).format()})`;
          rejections.push({ event, reason });
          dayRejections.push(`[${event.id}] REJECTED: Insufficient funds (requested ${money(event.amount, currency).format()})`);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        rejections.push({ event, reason: errorMsg });
        dayRejections.push(`[${event.id}] ERROR: ${errorMsg}`);
      }
    }

    // 2. Execute End-of-Day (EOD) processing for the day
    const eod = engine.processEODForAccount(accountId, day);

    // 3. Collect fee assessments
    let feeStr = "None";
    if (eod.overdraftFeeAssessed && eod.overdraftFeeEvent) {
      feeStr = `Overdraft Fee: ${money(eod.overdraftFeeEvent.amount, currency).format()} (Retroactive Day 2 overdraft)`;
    }

    // 4. Collect active authorization holds state
    const activeHolds = account.holds;
    let authStateStr = "None active";
    if (activeHolds.size > 0) {
      const holdItems = Array.from(activeHolds.entries()).map(
        ([authId, amt]) => `${authId}: ${money(amt, currency).format()}`
      );
      authStateStr = holdItems.join(", ");
    }

    // 5. Collect errors / rejections
    const errorsStr = dayRejections.length > 0 ? dayRejections.join("; ") : "None";

    // 6. Capitalization details (for Day 6)
    let capStr: string | undefined;
    if (eod.capitalizationEvent) {
      capStr = `Capitalized ${money(eod.capitalizationEvent.amount, currency).format()}`;
    }

    dailyReports.push({
      day,
      closingBalance: eod.closingBalance,
      availableBalance: account.getAvailableBalance(),
      dailyInterest: eod.dailyInterest,
      feeAssessments: feeStr,
      authorizationStates: authStateStr,
      errorsRejections: errorsStr,
      capitalizationInfo: capStr,
    });
  }

  return {
    engine,
    accountId,
    currency,
    dailyReports,
    eventsProcessed,
    rejections,
  };
}

/**
 * Formats the daily report table for Days 1–6 showing:
 * - Closing Balance
 * - Fee Assessments
 * - Authorization States
 * - Errors/Rejections
 */
export function formatDailyReportTable(
  reports: DailyReportRow[],
  currency: string = "AED"
): string {
  const headers = [
    "Day",
    "Closing Balance",
    "Available Bal",
    "Fee Assessments",
    "Authorization States",
    "Errors / Rejections",
  ];

  const rows = reports.map((r) => [
    `Day ${r.day}`,
    money(r.closingBalance, currency).format(),
    money(r.availableBalance, currency).format(),
    r.feeAssessments,
    r.authorizationStates,
    r.errorsRejections,
  ]);

  // Compute column widths
  const colWidths = headers.map((h, i) => {
    const maxRowLen = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0);
    return Math.max(h.length, maxRowLen);
  });

  const pad = (str: string, len: number, alignLeft: boolean = true) => {
    if (alignLeft) {
      return str.padEnd(len, " ");
    }
    return str.padStart(len, " ");
  };

  const separator = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";
  const headerLine = "| " + headers.map((h, i) => pad(h, colWidths[i]!)).join(" | ") + " |";

  const dataLines = rows.map(
    (row) => "| " + row.map((cell, i) => pad(cell, colWidths[i]!)).join(" | ") + " |"
  );

  const title = "============================== DAILY REPORT TABLE (DAYS 1–6) ==============================";

  return [
    title,
    separator,
    headerLine,
    separator,
    ...dataLines,
    separator,
  ].join("\n");
}

/**
 * Prints the daily report table and simulation summary to standard output.
 */
export function printDailyReportTable(
  reports: DailyReportRow[],
  currency: string = "AED"
): void {
  const table = formatDailyReportTable(reports, currency);
  console.log(table);
}

/**
 * Main application entry point:
 * 1. Replays E1 through E10 sequentially.
 * 2. Prints the daily report table for Days 1–6 showing Closing Balance, Fee Assessments, Authorization States, and Errors/Rejections.
 */
export function main(): void {
  console.log("Starting In-Memory Ledger Simulation (Replaying E1 through E10)...");
  const result = replayEvents();
  printDailyReportTable(result.dailyReports, result.currency);
}

// Automatically run main if executed directly via node or tsx
if (
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))
) {
  main();
}
