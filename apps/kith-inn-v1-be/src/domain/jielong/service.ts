import { createHash } from "node:crypto";
import { canonicalizeJielongInput, parseJielongText } from "@cfp/kith-inn-v1-shared";
import type {
  CmsJielongOrderCreate,
  JielongCommitInput,
  JielongCommitResponse,
  JielongPreviewResponse,
  Order
} from "@cfp/kith-inn-v1-shared";

export type JielongBinding = {
  sellerId: string | number;
  mealSlotId: string | number;
  unitPriceCents: number;
};
export type JielongCommitDeps = {
  findOrder: (mealSlotId: string | number, previewHash: string, lineNumber: number) => Promise<Order | null>;
  createOrder: (input: CmsJielongOrderCreate) => Promise<Order>;
};

export class JielongServiceError extends Error {
  readonly status = 409;
  readonly code = "jielong-preview-stale";
}

export function previewJielong(text: string, binding: JielongBinding): JielongPreviewResponse {
  const canonical = parseJielongText(text);
  const previewHash = createHash("sha256").update(JSON.stringify({
    canonical: canonicalizeJielongInput(canonical),
    sellerId: String(binding.sellerId),
    mealSlotId: String(binding.mealSlotId),
    unitPriceCents: binding.unitPriceCents
  })).digest("hex");
  const lines = canonical.lines.map((line) => ({
    ...line,
    unitPriceCents: binding.unitPriceCents,
    totalCents: line.quantity * binding.unitPriceCents
  }));
  return { previewHash, target: canonical.target, lines, totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0) };
}

const matchesLine = (order: Order, line: JielongPreviewResponse["lines"][number], binding: JielongBinding) =>
  order.source === "jielong-import" && String(order.mealSlotId) === String(binding.mealSlotId)
  && order.displayName === line.displayName && order.quantity === line.quantity;

export async function commitJielong(
  input: JielongCommitInput,
  binding: JielongBinding,
  deps: JielongCommitDeps
): Promise<JielongCommitResponse> {
  const preview = previewJielong(input.text, binding);
  const existing: (Order | null)[] = [];
  for (const line of preview.lines) {
    const order = await deps.findOrder(binding.mealSlotId, input.previewHash, line.lineNumber);
    if (order && !matchesLine(order, line, binding)) throw new JielongServiceError("接龙预览已失效");
    existing.push(order);
  }
  if (existing.every((order) => order !== null)) {
    return { previewHash: input.previewHash, results: existing.map((order, index) => ({
      lineNumber: preview.lines[index]!.lineNumber, status: "existing", orderId: order!.id
    })) };
  }
  if (preview.previewHash !== input.previewHash) throw new JielongServiceError("接龙预览已失效");

  const results: JielongCommitResponse["results"] = [];
  for (const [index, line] of preview.lines.entries()) {
    const found = existing[index];
    const doc = found ?? await deps.createOrder({
      mealSlotId: binding.mealSlotId, customerProfileId: null, customerOpenid: null,
      status: "draft", source: "jielong-import", displayName: line.displayName, address: null,
      quantity: line.quantity, unitPriceCents: binding.unitPriceCents, paymentStatus: "unpaid", paidAt: null,
      deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null, note: null,
      previewHash: input.previewHash, lineNumber: line.lineNumber
    });
    results.push({ lineNumber: line.lineNumber, status: found ? "existing" : "created", orderId: doc.id });
  }
  return { previewHash: input.previewHash, results };
}
