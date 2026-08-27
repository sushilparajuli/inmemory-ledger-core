export type EventType = "CREDIT" | "DEBIT" | "AUTHORIZATION" | "SETTLEMENT" | "REVERSAL";

export interface LedgerEvent {
  id: string;
  postedDay: number;
  valueDay: number;
  type: EventType;
  accountId: string;
  amount: bigint; // Minor units
  authId?: string;
  targetEventId?: string; // For reversals
}
