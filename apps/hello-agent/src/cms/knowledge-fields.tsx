import type { UIFieldServerProps } from "payload";
import { KnowledgeEvidencePanel } from "./knowledge-evidence-panel";
import { KnowledgeTestButton } from "./knowledge-test-button";

export function KnowledgeConnectionTest({ id }: UIFieldServerProps) {
  return <KnowledgeTestButton id={id} />;
}

export function TurnKnowledgeEvidence({ id }: UIFieldServerProps) {
  return <KnowledgeEvidencePanel id={id} />;
}
