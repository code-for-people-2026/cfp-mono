import { cms } from "../src/cms/client";
import { purgeExpiredEvidence } from "../src/operations/retention";
const payload = await cms();
try { console.log(JSON.stringify(await purgeExpiredEvidence(payload, process.argv.includes("--apply")))); }
finally { await payload.destroy(); }
