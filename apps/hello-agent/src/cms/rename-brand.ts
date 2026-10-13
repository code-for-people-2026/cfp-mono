import type { Payload } from "payload";

/** Explicit brand upgrade, separate from the create-only seed. Never reset an
 * administrator's prompt, enabled state or knowledge bindings to defaults. */
function renameLegacyBrand(text: string): string {
  return (
    text
      .replaceAll("「好人阿 J」（英文名 a jOKer）", "「阿 J 先生」")
      .replaceAll("好人阿 J · a jOKer", "阿 J 先生")
      .replaceAll("好人阿 J / a jOKer", "阿 J 先生")
      // Only branded Q names change; literary references to 阿Q stay intact.
      // Consume an existing 先生 suffix so repeated upgrades remain idempotent.
      .replace(
        /阿 ?Q ?(?:先生|\+)|好人阿 ?J|阿 ?J(?: ?先生)?|a jOKer/g,
        "阿 J 先生",
      )
      .replace(/阿 J 先生 (?=[\u4e00-\u9fff])/g, "阿 J 先生")
  );
}

export async function renameAgentBrand(payload: Payload) {
  const { docs } = await payload.find({
    collection: "agent-configs",
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  let updated = 0;
  for (const doc of docs) {
    const name = renameLegacyBrand(doc.name);
    const prompt = renameLegacyBrand(doc.prompt);
    if (name === doc.name && prompt === doc.prompt) continue;
    await payload.update({
      collection: "agent-configs",
      id: doc.id,
      data: { name, prompt },
      overrideAccess: true,
    });
    updated++;
  }
  return { updated, preserved: docs.length - updated };
}
