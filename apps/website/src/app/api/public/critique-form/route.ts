import configPromise from "@payload-config";
import { getPayload } from "payload";

export const dynamic = "force-dynamic";

const IDEAL_ORIGIN = "https://ideal.codeforpeople.cn";
const UNAVAILABLE = { unavailable: true } as const;

type PublicCritiqueForm = {
  label: string;
  url: string;
};

type FormLinkDocument = {
  label?: unknown;
  url?: unknown;
};

function publicCritiqueForm(value: unknown): PublicCritiqueForm | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const document = value as FormLinkDocument;
  const label = typeof document.label === "string" ? document.label.trim() : "";
  const url = typeof document.url === "string" ? document.url.trim() : "";
  if (!label || !url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return { label, url: parsed.href };
  } catch {
    return null;
  }
}

async function findPublicCritiqueForm(): Promise<PublicCritiqueForm | null> {
  const payload = await getPayload({ config: configPromise });
  let page = 1;

  while (true) {
    const result = await payload.find({
      collection: "form-links",
      where: { purpose: { equals: "critique" } },
      sort: "createdAt",
      page,
      limit: 1,
      depth: 0,
      select: { label: true, url: true },
      overrideAccess: true,
    });
    const form = publicCritiqueForm(result.docs[0]);
    if (form) return form;

    const nextPage = result.nextPage;
    if (typeof nextPage !== "number" || nextPage <= page) return null;
    page = nextPage;
  }
}

function responseHeaders(origin: string | null, preflight = false): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin === IDEAL_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", IDEAL_ORIGIN);
    if (preflight) {
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Accept");
    }
  }
  return headers;
}

export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);
  if (origin !== null && origin !== IDEAL_ORIGIN) {
    return Response.json(UNAVAILABLE, { status: 403, headers });
  }

  try {
    const form = await findPublicCritiqueForm();
    return Response.json(form ?? UNAVAILABLE, { headers });
  } catch {
    return Response.json(UNAVAILABLE, { status: 503, headers });
  }
}

export function OPTIONS(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: responseHeaders(request.headers.get("origin"), true),
  });
}
