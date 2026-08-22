import type { DialogueSuggestion, FeaturedProduct } from "./types";

export function dialogueSuggestionsWithFeaturedProduct(
  suggestions: DialogueSuggestion[],
  product: FeaturedProduct,
): DialogueSuggestion[] {
  const secondarySuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.label !== product.discoveryQuestion.label &&
      suggestion.value.trim() !== product.discoveryQuestion.value,
  );

  return [product.discoveryQuestion, ...secondarySuggestions.slice(-3)];
}

export function featuredProductAnswer(
  question: string,
  product: FeaturedProduct,
): string | null {
  if (question.trim() !== product.discoveryQuestion.value) return null;

  return `${product.name}是${product.brandRelationship}。${product.exploration}，但${product.humanResponsibility}。当前公开的是${product.stage.label}，${product.stage.dataBoundary}，也${product.stage.serviceBoundary}。`;
}

export function featuredProductStageNotice(product: FeaturedProduct): string {
  return `${product.stage.label} · ${product.stage.dataBoundary} · ${product.stage.serviceBoundary}`;
}
