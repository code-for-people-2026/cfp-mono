import { parseArgs } from "node:util";
import { cms } from "../src/cms/client";
import { adoptLegacyEvidence } from "../src/operations/retention";

const { values } = parseArgs({ options: {
  apply: { type: "boolean", default: false },
  activate: { type: "boolean", default: false },
  "schedule-until": { type: "string" },
  reason: { type: "string" },
  "expected-count": { type: "string" },
  "expected-revisions": { type: "string" },
}, strict: true });

let expectedRevisions: Record<string, number> | undefined;
if (values["expected-revisions"]) {
  const parsed: unknown = JSON.parse(values["expected-revisions"]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.entries(parsed).some(([id, revision]) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(revision) || Number(revision) < 0))
    throw new Error("--expected-revisions 必须是案件ID到非负修订号的JSON对象");
  expectedRevisions = parsed as Record<string, number>;
}
const expectedCount = values["expected-count"] === undefined ? undefined : Number(values["expected-count"]);
if (expectedCount !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) throw new Error("--expected-count 必须是非负整数");

const payload = await cms();
try {
  // Output contains counts and bounded case metadata only, never evidence excerpts,
  // operator reasons, owner identifiers, or case free text.
  console.log(JSON.stringify(await adoptLegacyEvidence(payload, {
    apply: values.apply,
    activate: values.activate,
    scheduleUntil: values["schedule-until"],
    reason: values.reason,
    expectedCount,
    expectedRevisions,
  })));
} finally {
  await payload.destroy();
}
