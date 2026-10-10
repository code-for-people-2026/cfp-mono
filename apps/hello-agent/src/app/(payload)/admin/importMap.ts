import { CollectionCards } from "@payloadcms/next/rsc";
import {
  InputCell,
  GreetingCell,
  ExecutionCell,
  MediaCell,
  RecommendedColumns,
} from "../../../cms/admin-cells";
export const importMap = {
  "@payloadcms/next/rsc#CollectionCards": CollectionCards,
  "/src/cms/admin-cells#InputCell": InputCell,
  "/src/cms/admin-cells#GreetingCell": GreetingCell,
  "/src/cms/admin-cells#ExecutionCell": ExecutionCell,
  "/src/cms/admin-cells#MediaCell": MediaCell,
  "/src/cms/admin-cells#RecommendedColumns": RecommendedColumns,
};
