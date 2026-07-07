import type { CardPayload } from "@cfp/kith-inn-shared";

export type ChatCardMessage = {
  role: "user" | "assistant";
  content: string;
  card?: CardPayload;
  fromHistory?: boolean;
};
