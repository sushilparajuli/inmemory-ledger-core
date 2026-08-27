import { describe, expect, it } from "vitest";
import type { EventType, LedgerEvent } from "./index";

describe("LedgerEvent interfaces", () => {
  it("allows constructing valid LedgerEvent objects with required and optional fields", () => {
    const creditEvent: LedgerEvent = {
      id: "evt-1",
      postedDay: 1,
      valueDay: 1,
      type: "CREDIT",
      accountId: "acc-1",
      amount: 10000n,
    };

    expect(creditEvent.id).toBe("evt-1");
    expect(creditEvent.postedDay).toBe(1);
    expect(creditEvent.valueDay).toBe(1);
    expect(creditEvent.type).toBe("CREDIT");
    expect(creditEvent.accountId).toBe("acc-1");
    expect(creditEvent.amount).toBe(10000n);
    expect(creditEvent.authId).toBeUndefined();
    expect(creditEvent.targetEventId).toBeUndefined();

    const authEvent: LedgerEvent = {
      id: "evt-2",
      postedDay: 1,
      valueDay: 1,
      type: "AUTHORIZATION",
      accountId: "acc-1",
      amount: 5000n,
      authId: "auth-123",
    };
    expect(authEvent.authId).toBe("auth-123");

    const reversalEvent: LedgerEvent = {
      id: "evt-3",
      postedDay: 2,
      valueDay: 1,
      type: "REVERSAL",
      accountId: "acc-1",
      amount: 5000n,
      targetEventId: "evt-2",
    };
    expect(reversalEvent.type).toBe("REVERSAL");
    expect(reversalEvent.targetEventId).toBe("evt-2");
  });

  it("supports all required EventType variants", () => {
    const types: EventType[] = ["CREDIT", "DEBIT", "AUTHORIZATION", "SETTLEMENT", "REVERSAL"];
    expect(types).toHaveLength(5);
  });
});
