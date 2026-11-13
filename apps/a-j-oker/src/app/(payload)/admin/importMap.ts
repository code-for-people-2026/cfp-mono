import { OperationsListTools, OperationsDocumentActions } from "../../../operations/admin-components";
import { CollectionCards } from "@payloadcms/next/rsc";
import {
  InputCell,
  GreetingCell,
  ExecutionCell,
  MediaCell,
  RecommendedColumns,
} from "../../../cms/admin-cells";
import {
  KnowledgeConnectionTest,
  TurnKnowledgeEvidence,
} from "../../../cms/knowledge-fields";
export const importMap = {
  "/src/operations/admin-components#OperationsDocumentActions": OperationsDocumentActions,
  "/src/operations/admin-components#OperationsListTools": OperationsListTools,
  "/src/cms/knowledge-fields#TurnKnowledgeEvidence": TurnKnowledgeEvidence,
  "/src/cms/knowledge-fields#KnowledgeConnectionTest": KnowledgeConnectionTest,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards,
  "/src/cms/admin-cells#InputCell": InputCell,
  "/src/cms/admin-cells#GreetingCell": GreetingCell,
  "/src/cms/admin-cells#ExecutionCell": ExecutionCell,
  "/src/cms/admin-cells#MediaCell": MediaCell,
  "/src/cms/admin-cells#RecommendedColumns": RecommendedColumns,
};
