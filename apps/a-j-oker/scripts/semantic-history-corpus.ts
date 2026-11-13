/** Historical routing-keyword corpus and simple lexical extraction helpers. */
import manifestData from "../docs/semantic-keyword-history.json";

export type InteractionFlags = {
  minor: boolean;
  crisis: boolean;
  dependency: boolean;
  overuse: boolean;
  exit: boolean;
  forget_context: boolean;
  image_requested: boolean;
};

export type SemanticHistoryCase = {
  id: string;
  kind: string;
  input: string;
  context?: string;
  purpose?: "image_generation";
  expected: {
    decision: "allow" | "block" | "uncertain";
    serviceScope: "support" | "outside" | "unclear";
    interaction: InteractionFlags;
  };
  keywords: string[];
  sourceRegexIds: string[];
  notes?: string;
};

export type SemanticHistoryManifest = {
  version: string;
  generatedAt: string;
  source: {
    file: string;
    regexCount: number;
    occurrencePolicy: string;
  };
  lexicalPolicy: {
    chinese: string;
    english: string;
    manualExpansions: string[];
    exclusions: string[];
  };
  counts: { regex: number; keyword: number; case: number };
  originalRegexes: Array<{
    id: string;
    pattern: string;
    source: {
      commit: string;
      path: string;
      line: number;
      date: string;
      subject: string;
      chain: string;
    };
    keywords: string[];
    caseIds: string[];
    excludedFromCaseGeneration: boolean;
    exclusionReason?: string;
    occurrences: unknown[];
  }>;
  keywords: Array<{
    value: string;
    sourceRegexIds: string[];
    caseIds: string[];
    ordinaryDisclosureCaseIds: string[];
  }>;
  cases: SemanticHistoryCase[];
};

export const semanticHistoryCorpus = manifestData as SemanticHistoryManifest;

/**
 * Deliberately lexical only: pull contiguous literal-looking Chinese and English
 * runs. This function does not understand or enumerate regex syntax.
 */
export function lexicalKeywords(pattern: string): string[] {
  return [...new Set(pattern.match(/[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_-]{1,}/g) ?? [])];
}

export const manualCompoundExpansions: readonly string[] = semanticHistoryCorpus.lexicalPolicy.manualExpansions;

export function semanticHistoryCases(filter?: string): SemanticHistoryCase[] {
  const needle = filter?.trim().toLowerCase();
  if (!needle) return semanticHistoryCorpus.cases;
  return semanticHistoryCorpus.cases.filter((row) =>
    row.id.toLowerCase().includes(needle) || row.kind.toLowerCase().includes(needle)
  );
}

export function ordinaryDisclosureCases(): SemanticHistoryCase[] {
  return semanticHistoryCorpus.cases.filter((row) => row.kind === "ordinary-disclosure");
}
