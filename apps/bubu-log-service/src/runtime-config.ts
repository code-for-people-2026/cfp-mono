import path from "node:path";
import { fileURLToPath } from "node:url";
import { zh } from "payload/i18n/zh";
import { buildStoreConfig } from "./store";
import { recordCollections } from "./records/persistence";
import { chatCollections } from "./chat/persistence";
import { membershipCollections } from "./membership/persistence";
import { operationsCollections, decorateCollections, installOpsConstraints } from "./operations/collections";

export const serviceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const identityDirectory = () => process.env.BUBU_IDENTITY_DIRECTORY || path.join(serviceDirectory, ".data");
export const operationsOrigin = () => new URL(process.env.BUBU_OPS_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3320}`).origin;

/** The same sanitized configuration is passed to the Store and every Payload Admin route. */
export function buildRuntimeConfig(options: { directory: string; secret?: string; origin: string; schemaOnly?: boolean }) {
  const secureCookie = process.env.NODE_ENV === "production" || new URL(options.origin).protocol === "https:";
  const operatorCollections = operationsCollections.map(collection => collection.slug === "ops-users" && typeof collection.auth === "object"
    ? { ...collection, auth: { ...collection.auth, cookies: { ...collection.auth.cookies, secure: secureCookie } } }
    : collection);
  const origin = new URL(options.origin).origin;
  return buildStoreConfig({
    directory: options.directory, secret: options.secret, schemaOnly: options.schemaOnly,
    extensions: [...recordCollections, ...chatCollections, ...membershipCollections, ...operatorCollections],
    configure: config => ({
      ...config,
      collections: decorateCollections(config.collections || []),
      routes: { admin: "/admin", api: "/api/cms" },
      serverURL: origin,
      cors: [origin], csrf: [origin],
      cookiePrefix: "bubu-ops",
      graphQL: { disable: true },
      i18n: { supportedLanguages: { zh }, fallbackLanguage: "zh" },
      admin: {
        user: "ops-users",
        meta: { titleSuffix: " · 哺哺日记运营" },
        importMap: { autoGenerate: false, baseDir: serviceDirectory },
        components: { beforeDashboard: ["/src/operations/components#OperationsTools"] },
      },
      onInit: installOpsConstraints,
    }),
  });
}
