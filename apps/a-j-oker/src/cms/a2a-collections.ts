import type {
  Access,
  CollectionBeforeChangeHook,
  CollectionConfig,
  Field,
} from "payload";

import { isAdministrator } from "../operations/policy";
import { sensitiveReadAudit } from "../operations/audit";
import { guardAgeWrite } from "../age/collections";
import { guardPrivacyWrite } from "../privacy/collections";
import { guardSafetyWrite } from "../operations/guards";
import { AppError } from "../domain/contracts";
import { guardSessionLease } from "./session-lease";

const internalRead: Access = ({ req }) => {
  if (isAdministrator(req.user)) return true;
  const owner = req.context.helloOwner;
  return typeof owner === "string" && req.context.helloA2A === true
    ? { owner: { equals: owner } }
    : false;
};

const internalCreate: Access = ({ req }) =>
  typeof req.context.helloOwner === "string"
  && req.context.helloWrite === true
  && req.context.helloA2A === true;

const internalOwnedWrite: Access = ({ req }) => {
  const owner = req.context.helloOwner;
  return typeof owner === "string"
    && req.context.helloWrite === true
    && req.context.helloA2A === true
    ? { owner: { equals: owner } }
    : false;
};

const guardInternalOwner: CollectionBeforeChangeHook = ({ req, data, originalDoc }) => {
  const owner = req.context.helloOwner;
  const nextOwner = data.owner ?? originalDoc?.owner;
  if (
    typeof owner !== "string"
    || nextOwner !== owner
    || (typeof originalDoc?.owner === "string" && originalDoc.owner !== owner)
  ) {
    throw new AppError(403, "A2A execution state owner is not authorized");
  }
  return data;
};

const scopeFields: Field[] = [
  { name: "owner", type: "text", required: true, index: true },
  { name: "tenant", type: "text", required: true, index: true },
  { name: "agentId", type: "text", required: true, index: true },
  { name: "key", type: "text", required: true, unique: true },
];

const hooks = {
  beforeChange: [
    guardInternalOwner,
    guardSessionLease,
    guardPrivacyWrite,
    guardAgeWrite,
    guardSafetyWrite,
  ],
  afterRead: [sensitiveReadAudit],
};

/** Internal execution state: never exposed through visitor-facing Payload REST. */
export const a2aCollections: CollectionConfig[] = [
  {
    slug: "a2a-execution-tasks",
    lockDocuments: false,
    admin: { hidden: true },
    access: {
      read: internalRead,
      create: internalCreate,
      update: internalOwnedWrite,
      delete: internalOwnedWrite,
    },
    hooks,
    fields: [
      ...scopeFields,
      { name: "taskId", type: "text", required: true, index: true },
      { name: "contextId", type: "text", required: true, index: true },
      { name: "state", type: "number", required: true, index: true },
      { name: "statusTimestamp", type: "date", index: true },
      { name: "revision", type: "number", required: true, min: 1 },
      {
        name: "snapshot",
        type: "json",
        required: true,
        typescriptSchema: [
          () => ({ type: "object", tsType: 'import("@cfp/agent-a2a").Task' }),
        ],
      },
    ],
  },
  {
    slug: "a2a-request-ledgers",
    lockDocuments: false,
    admin: { hidden: true },
    access: {
      read: internalRead,
      create: internalCreate,
      update: internalOwnedWrite,
      delete: internalOwnedWrite,
    },
    hooks,
    fields: [
      ...scopeFields,
      { name: "requestIdentity", type: "text", required: true },
      { name: "fingerprint", type: "text", required: true },
      {
        name: "status",
        type: "select",
        required: true,
        options: ["pending", "recorded", "failed"],
      },
      { name: "taskId", type: "text", index: true },
      { name: "contextId", type: "text", index: true },
      { name: "revision", type: "number", required: true, min: 1 },
    ],
  },
];
