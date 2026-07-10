import {
  importCommitInputSchema,
  importPreviewInputSchema,
  offeringCreateSchema,
  offeringUpdateSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  ImportCommitResponse,
  Offering,
  OfferingCreate,
  OfferingUpdate
} from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  conflictActionFor,
  ImportTextError,
  previewImport
} from "../domain/offerings/importText";
import {
  CmsOfferingError,
  createOffering as createOfferingFn,
  listOfferings as listOfferingsFn,
  updateOffering as updateOfferingFn
} from "../lib/cms/offerings";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type OfferingsDeps = {
  listOfferings: (token: string, active: "all" | "true" | "false") => Promise<Offering[]>;
  createOffering: (token: string, input: OfferingCreate) => Promise<Offering>;
  updateOffering: (token: string, id: string | number, input: OfferingUpdate) => Promise<Offering>;
};

const defaultDeps: OfferingsDeps = {
  listOfferings: listOfferingsFn,
  createOffering: createOfferingFn,
  updateOffering: updateOfferingFn
};

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function cmsError(c: Context, error: unknown) {
  if (!(error instanceof CmsOfferingError)) {
    return c.json({ error: "cms-unavailable", message: "菜品服务暂不可用" }, 502);
  }
  const status = ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
    ? error.status as 401 | 403 | 404 | 409 | 422
    : 502;
  return c.json({ error: error.code, message: error.message }, status);
}

function writeError(error: unknown): string {
  return error instanceof CmsOfferingError ? error.message : "写入失败";
}

export function offeringsRoutes(secret: string, deps: OfferingsDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  app.get("/", async (c) => {
    const active = c.req.query("active") ?? "all";
    if (active !== "all" && active !== "true" && active !== "false") {
      return c.json({ error: "invalid-active-filter", message: "active 参数无效" }, 400);
    }
    try {
      return c.json({ docs: await deps.listOfferings(c.get("operatorToken"), active) });
    } catch (error) {
      return cmsError(c, error);
    }
  });

  app.post("/import/preview", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = importPreviewInputSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-import-input", message: "导入文本无效" }, 422);
    try {
      return c.json(previewImport(
        parsed.data.text,
        await deps.listOfferings(c.get("operatorToken"), "all")
      ));
    } catch (error) {
      if (error instanceof ImportTextError) return c.json({ error: error.code, message: error.message }, 422);
      return cmsError(c, error);
    }
  });

  app.post("/import/commit", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = importCommitInputSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-import-input", message: "导入提交无效" }, 422);
    try {
      const token = c.get("operatorToken");
      const preview = previewImport(parsed.data.text, await deps.listOfferings(token, "all"));
      const results: ImportCommitResponse["results"] = [];
      for (const row of preview.rows) {
        if (row.status === "invalid") {
          results.push({ line: row.line, status: "failed", error: row.error });
        } else if (row.status === "conflict" && conflictActionFor(row.line, parsed.data.conflicts) === "skip") {
          results.push({ line: row.line, status: "skipped", id: row.existingId });
        } else {
          try {
            const doc = row.status === "conflict"
              ? await deps.updateOffering(token, row.existingId, row.parsed)
              : await deps.createOffering(token, row.parsed);
            results.push({
              line: row.line,
              status: row.status === "conflict" ? "overwritten" : "created",
              id: doc.id
            });
          } catch (error) {
            results.push({ line: row.line, status: "failed", error: writeError(error) });
          }
        }
      }
      return c.json({
        results,
        summary: {
          created: results.filter(({ status }) => status === "created").length,
          overwritten: results.filter(({ status }) => status === "overwritten").length,
          skipped: results.filter(({ status }) => status === "skipped").length,
          failed: results.filter(({ status }) => status === "failed").length
        }
      });
    } catch (error) {
      if (error instanceof ImportTextError) return c.json({ error: error.code, message: error.message }, 422);
      return cmsError(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = offeringCreateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-offering", message: "菜品字段无效" }, 422);
    try {
      return c.json({ doc: await deps.createOffering(c.get("operatorToken"), parsed.data) }, 201);
    } catch (error) {
      return cmsError(c, error);
    }
  });

  app.patch("/:id", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = offeringUpdateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-offering-update", message: "菜品更新字段无效" }, 422);
    try {
      return c.json({
        doc: await deps.updateOffering(c.get("operatorToken"), c.req.param("id"), parsed.data)
      });
    } catch (error) {
      return cmsError(c, error);
    }
  });

  return app;
}
