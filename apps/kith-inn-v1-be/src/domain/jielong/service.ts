import { createHash } from "node:crypto";
import { canonicalizeJielongInput, parseJielongText } from "@cfp/kith-inn-v1-shared";
import type {
  CmsJielongOrderCreate,
  JielongCanonicalLine,
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
  getUnitPriceCents: () => Promise<number>;
};

export class JielongServiceError extends Error {
  readonly status = 409;
  readonly code = "preview-hash-mismatch";
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

const matchesLine = (order: Order, line: JielongCanonicalLine, binding: Omit<JielongBinding, "unitPriceCents">) =>
  order.source === "jielong-import" && String(order.sellerId) === String(binding.sellerId)
  && String(order.mealSlotId) === String(binding.mealSlotId)
  && order.displayName === line.displayName && order.quantity === line.quantity;

export async function commitJielong(
  input: JielongCommitInput,
  binding: Omit<JielongBinding, "unitPriceCents">,
  deps: JielongCommitDeps
): Promise<JielongCommitResponse> {
  const canonical = parseJielongText(input.text);
  const existing: (Order | null)[] = [];
  for (const line of canonical.lines) {
    const order = await deps.findOrder(binding.mealSlotId, input.previewHash, line.lineNumber);
    if (order && !matchesLine(order, line, binding)) throw new JielongServiceError("接龙预览已失效");
    existing.push(order);
  }
  if (existing.every((order) => order !== null)) {
    const originalUnitPriceCents = existing[0]!.unitPriceCents;
    const original = previewJielong(input.text, { ...binding, unitPriceCents: originalUnitPriceCents });
    if (original.previewHash !== input.previewHash
      || existing.some((order) => order!.unitPriceCents !== originalUnitPriceCents)) {
      throw new JielongServiceError("接龙预览已失效");
    }
    return { previewHash: input.previewHash, results: existing.map((order, index) => ({
      lineNumber: canonical.lines[index]!.lineNumber, status: "existing", orderId: order!.id
    })) };
  }
  const unitPriceCents = await deps.getUnitPriceCents();
  const preview = previewJielong(input.text, { ...binding, unitPriceCents });
  if (preview.previewHash !== input.previewHash) throw new JielongServiceError("接龙预览已失效");

  const results: JielongCommitResponse["results"] = [];
  for (const [index, line] of preview.lines.entries()) {
    const found = existing[index];
    const doc = found ?? await deps.createOrder({
      mealSlotId: binding.mealSlotId, customerProfileId: null, customerOpenid: null,
      status: "draft", source: "jielong-import", displayName: line.displayName, address: null,
      quantity: line.quantity, unitPriceCents, paymentStatus: "unpaid", paidAt: null,
      deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null, note: null,
      previewHash: input.previewHash, lineNumber: line.lineNumber
    });
    results.push({ lineNumber: line.lineNumber, status: found ? "existing" : "created", orderId: doc.id });
  }
  return { previewHash: input.previewHash, results };
}
