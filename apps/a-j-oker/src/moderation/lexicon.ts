import base from "./lexicon.json";
import project from "./project-lexicon.json";
import { normalizeKeywordText } from "../domain/keyword-matcher";

// Preserve the pinned public source and its ordering. Project phrases only
// recall semantic review; they never become unconditional rejection rules.
const words = [...new Set([...base.words, ...project.entries.map(entry => entry.word)]
  .map(word => normalizeKeywordText(word).trim()).filter(Boolean))];

const lexicon = { version: `${base.version}+${project.version}`, words };
export default lexicon;
