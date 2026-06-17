import { DocumentPage } from "../../shared/document-page";
import { getDocument, getUiStrings } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function ManifestoPage() {
  const [document, ui] = await Promise.all([getDocument("manifesto"), getUiStrings()]);
  return <DocumentPage document={document} backToHome={ui.backToHome} />;
}
