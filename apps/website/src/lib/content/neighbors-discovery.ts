import {
  neighborsDiscoveryQuestion,
  neighborsIdentity,
} from "@/content/neighbors";
import type {
  DialogueSuggestion,
  NeighborsDiscoveryContent,
  NeighborsPageContent,
} from "./types";

export function withNeighborsDiscoveryQuestion(
  suggestions: DialogueSuggestion[],
): DialogueSuggestion[] {
  const secondarySuggestions = suggestions.filter(
    ({ label, value }) =>
      label !== neighborsDiscoveryQuestion.label &&
      value.trim() !== neighborsDiscoveryQuestion.value,
  );

  return [neighborsDiscoveryQuestion, ...secondarySuggestions.slice(-3)];
}

export function buildNeighborsDiscovery(
  page: NeighborsPageContent,
): NeighborsDiscoveryContent {
  return {
    question: neighborsDiscoveryQuestion,
    primaryAction: {
      ...page.cta,
      href: neighborsIdentity.prototypeUrl,
    },
    secondaryAction: {
      label: "进一步了解近邻互助组",
      href: `/${neighborsIdentity.slug}`,
    },
  };
}
