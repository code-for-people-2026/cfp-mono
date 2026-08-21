import { DocumentPage } from "../../shared/document-page";
import { getDocument } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function LicensePage() {
  const document = await getDocument("license");
  return <DocumentPage document={document} />;
}
