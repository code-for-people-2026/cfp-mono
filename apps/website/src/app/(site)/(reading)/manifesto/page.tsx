import { DocumentPage } from "../../shared/document-page";
import { getDocument } from "@/lib/content";

export const dynamic = "force-dynamic";

export default async function ManifestoPage() {
  const document = await getDocument("manifesto");
  return <DocumentPage document={document} />;
}
