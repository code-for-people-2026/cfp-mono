import type { CardPayload } from "@cfp/kith-inn-shared";

export const CUSTOMER_CONFIRM_ACTION_LABEL = "全部建档并记单";
export const CUSTOMER_CONFIRM_STALE_TEXT = "这张确认卡已过期，请重新识别接龙生成新的确认卡";

export type ChatCardMessage = {
  role: "user" | "assistant";
  content: string;
  card?: CardPayload;
  fromHistory?: boolean;
};

export type CustomerConfirmActionState =
  | { status: "active"; label: string }
  | { status: "confirmed"; label: string; message: string }
  | { status: "stale"; label: string; message: string };

export function getCustomerConfirmActionState(
  messages: readonly ChatCardMessage[],
  index: number,
  confirmed: ReadonlySet<number>,
): CustomerConfirmActionState | null {
  const message = messages[index];
  if (!message || message.role !== "assistant" || message.card?.type !== "customer-confirm") return null;
  if (confirmed.has(index)) {
    return { status: "confirmed", label: CUSTOMER_CONFIRM_ACTION_LABEL, message: "已建" };
  }
  if (message.fromHistory) {
    return { status: "stale", label: CUSTOMER_CONFIRM_ACTION_LABEL, message: CUSTOMER_CONFIRM_STALE_TEXT };
  }

  const latestCurrentIndex = messages.reduce((latest, item, i) => {
    if (
      item.role === "assistant" &&
      item.card?.type === "customer-confirm" &&
      !item.fromHistory &&
      !confirmed.has(i)
    ) {
      return i;
    }
    return latest;
  }, -1);

  return index === latestCurrentIndex
    ? { status: "active", label: CUSTOMER_CONFIRM_ACTION_LABEL }
    : { status: "stale", label: CUSTOMER_CONFIRM_ACTION_LABEL, message: CUSTOMER_CONFIRM_STALE_TEXT };
}
