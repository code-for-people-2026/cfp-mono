import type { UIFieldServerProps } from "payload";
import { KnowledgeTestButton } from "./knowledge-test-button";

export function KnowledgeConnectionTest({ id }: UIFieldServerProps) {
  return <KnowledgeTestButton id={id} />;
}
