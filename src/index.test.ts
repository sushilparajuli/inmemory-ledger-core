import { describe, expect, it, vi } from "vitest";
import {
  Account,
  Money,
  money,
  getCurrencyDecimals,
  LedgerEngine,
  Engine,
  DEFAULT_EVENTS,
  replayEvents,
  formatDailyReportTable,
  printDailyReportTable,
  main,
} from "./index";

describe("index exports and replay simulation", () => {
  it("exports core classes, models, and simulation functions", () => {
    expect(Account).toBeDefined();
    expect(Money).toBeDefined();
    expect(money).toBeDefined();
    expect(getCurrencyDecimals).toBeDefined();
    expect(LedgerEngine).toBeDefined();
    expect(Engine).toBeDefined();
    expect(DEFAULT_EVENTS).toBeDefined();
    expect(DEFAULT_EVENTS).toHaveLength(10);
    expect(replayEvents).toBeDefined();
    expect(formatDailyReportTable).toBeDefined();
    expect(printDailyReportTable).toBeDefined();
    expect(main).toBeDefined();
  });

  it("replays E1 through E10 sequentially and produces 6 daily reports", () => {
    const result = replayEvents();

    expect(result.dailyReports).toHaveLength(6);
    expect(result.accountId).toBe("ACC-001");
    expect(result.currency).toBe("AED");

    // Day 1: Credit 1,000.00, Auth 300.00 (AUTH-101)
    const day1 = result.dailyReports[0]!;
    expect(day1.day).toBe(1);
    expect(day1.closingBalance).toBe(100000n); // AED 1,000.00
    expect(day1.availableBalance).toBe(70000n); // AED 700.00
    expect(day1.dailyInterest).toBe(40n); // 100,000 * 0.0004 = 40n
    expect(day1.authorizationStates).toContain("AUTH-101");
    expect(day1.feeAssessments).toBe("None");
    expect(day1.errorsRejections).toBe("None");

    // Day 2: Settlement 300.00, Auth 800.00 (Rejected), Auth 200.00 (Approved)
    const day2 = result.dailyReports[1]!;
    expect(day2.day).toBe(2);
    expect(day2.closingBalance).toBe(70000n); // AED 700.00
    expect(day2.availableBalance).toBe(50000n); // AED 500.00 (700.00 - 200.00)
    expect(day2.dailyInterest).toBe(28n); // 70,000 * 0.0004 = 28n
    expect(day2.authorizationStates).toContain("AUTH-103");
    expect(day2.errorsRejections).toContain("[E4] REJECTED");

    // Day 3: Reversal 200.00 (Releases AUTH-103)
    const day3 = result.dailyReports[2]!;
    expect(day3.day).toBe(3);
    expect(day3.closingBalance).toBe(70000n); // AED 700.00
    expect(day3.availableBalance).toBe(70000n); // AED 700.00
    expect(day3.dailyInterest).toBe(28n); // 70,000 * 0.0004 = 28n
    expect(day3.authorizationStates).toBe("None active");
    expect(day3.errorsRejections).toBe("None");

    // Day 4: Unmatched Settlement 150.00 (AUTH-Z), Credit 500.00
    const day4 = result.dailyReports[3]!;
    expect(day4.day).toBe(4);
    expect(day4.closingBalance).toBe(105000n); // 700.00 - 150.00 + 500.00 = 1,050.00
    expect(day4.availableBalance).toBe(105000n);
    expect(day4.dailyInterest).toBe(42n); // 105,000 * 0.0004 = 42n

    // Day 5: Backdated E7 (valueDay 2: -750.00), Auth 100.00 (AUTH-104)
    // Day 2 retroactive closing balance becomes: 1000 - 300 - 750 = -50.00 (Negative!) -> Triggers Overdraft Fee
    const day5 = result.dailyReports[4]!;
    expect(day5.day).toBe(5);
    expect(day5.feeAssessments).toContain("Overdraft Fee");
    expect(day5.authorizationStates).toContain("AUTH-104");

    // Day 6: Interest Capitalization
    const day6 = result.dailyReports[5]!;
    expect(day6.day).toBe(6);
    expect(day6.capitalizationInfo).toContain("Capitalized");
    expect(day6.closingBalance).toBeGreaterThan(0n);
  });

  it("formats and prints the daily report table with required columns", () => {
    const result = replayEvents();
    const tableStr = formatDailyReportTable(result.dailyReports, result.currency);

    expect(tableStr).toContain("Closing Balance");
    expect(tableStr).toContain("Fee Assessments");
    expect(tableStr).toContain("Authorization States");
    expect(tableStr).toContain("Errors / Rejections");
    expect(tableStr).toContain("Day 1");
    expect(tableStr).toContain("Day 6");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printDailyReportTable(result.dailyReports, result.currency);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("DAILY REPORT TABLE"));
    logSpy.mockRestore();
  });

  it("runs main() and prints simulation start message and report table", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    main();
    expect(logSpy).toHaveBeenCalledWith("Starting In-Memory Ledger Simulation (Replaying E1 through E10)...");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("DAILY REPORT TABLE"));
    logSpy.mockRestore();
  });
});
