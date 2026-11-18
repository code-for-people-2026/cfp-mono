import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;
type JsonObject = { [key: string]: JsonValue };

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toolNames: Record<string, string> = {
  hello_save_greeting: "hello_save_a_j_oker",
  save_greeting: "save_a_j_oker",
};

function renameExactToolName(value: JsonValue | undefined) {
  return typeof value === "string" ? toolNames[value] : undefined;
}

/** Rename only the reply property at the root of a save tool payload. */
function renameSaveToolRoot(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === "greeting" ? "aJoker" : key,
      item,
    ]),
  );
}

/** Rename only ADK protocol identifiers; every textual value stays verbatim. */
function renameAdkSnapshot(snapshot: JsonValue): JsonValue {
  if (!isJsonObject(snapshot) || !Array.isArray(snapshot.events)) return snapshot;
  return {
    ...snapshot,
    events: snapshot.events.map((event) => {
      if (!isJsonObject(event)) return event;
      const author = event.author === "greeting_agent" ? "a_j_oker_agent" : event.author;
      const content = isJsonObject(event.content) && Array.isArray(event.content.parts)
        ? {
            ...event.content,
            parts: event.content.parts.map((part) => {
              if (!isJsonObject(part)) return part;
              let nextPart = part;
              const functionCall = isJsonObject(part.functionCall)
                ? part.functionCall as JsonObject
                : undefined;
              const functionCallName = functionCall
                ? renameExactToolName(functionCall.name)
                : undefined;
              if (functionCall && functionCallName)
                nextPart = {
                  ...nextPart,
                  functionCall: {
                    ...functionCall,
                    name: functionCallName,
                    ...(isJsonObject(functionCall.args)
                      ? { args: renameSaveToolRoot(functionCall.args) }
                      : {}),
                  },
                };
              const functionResponse = isJsonObject(part.functionResponse)
                ? part.functionResponse as JsonObject
                : undefined;
              const functionResponseName = functionResponse
                ? renameExactToolName(functionResponse.name)
                : undefined;
              if (functionResponse && functionResponseName)
                nextPart = {
                  ...nextPart,
                  functionResponse: {
                    ...functionResponse,
                    name: functionResponseName,
                    ...(isJsonObject(functionResponse.response)
                      ? { response: renameSaveToolRoot(functionResponse.response) }
                      : {}),
                  },
                };
              return nextPart;
            }),
          }
        : event.content;
      return { ...event, author, content };
    }),
  };
}

function renameReplyKey(reply: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(reply).map(([key, value]) => [
      key === "greeting" ? "aJoker" : key,
      value,
    ]),
  );
}

/** Rename the response property only inside the psychology-plan data artifact. */
function renameA2ASnapshot(snapshot: JsonValue): JsonValue {
  if (!isJsonObject(snapshot) || !Array.isArray(snapshot.artifacts)) return snapshot;
  return {
    ...snapshot,
    artifacts: snapshot.artifacts.map((artifact) => {
      if (!isJsonObject(artifact) || artifact.artifactId !== "psychology-plan" || !Array.isArray(artifact.parts))
        return artifact;
      return {
        ...artifact,
        parts: artifact.parts.map((part) => {
          if (
            !isJsonObject(part)
            || !isJsonObject(part.content)
            || part.content.$case !== "data"
            || !isJsonObject(part.content.value)
            || !isJsonObject(part.content.value.reply)
          ) return part;
          return {
            ...part,
            content: {
              ...part.content,
              value: {
                ...part.content.value,
                reply: renameReplyKey(part.content.value.reply),
              },
            },
          };
        }),
      };
    }),
  };
}

/** Rename the response property only at the root of a safety evaluation output. */
function renameSafetyEvaluationOutput(value: JsonValue): JsonValue {
  return isJsonObject(value) ? renameReplyKey(value) : value;
}

async function renameJsonKeys(
  { db }: Pick<MigrateUpArgs, "db">,
  table: string,
  column: string,
  transform: (value: JsonValue) => JsonValue,
) {
  const rows = await db.all<{ id: number; value: string }>(
    sql.raw(
      `SELECT id, ${column} AS value FROM ${table} ` +
        `WHERE ${column} LIKE '%greeting%'`,
    ),
  );
  for (const row of rows) {
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(row.value) as JsonValue;
    } catch {
      // Invalid JSON cannot be safely interpreted. Leave it byte-for-byte
      // unchanged rather than turning a historical storage issue into data loss.
      continue;
    }
    const renamed = JSON.stringify(transform(parsed));
    if (renamed !== row.value)
      await db.run(
        sql`UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = ${renamed} WHERE id = ${row.id}`,
      );
  }
}

async function renameAgentConfigPrompts({ db }: Pick<MigrateUpArgs, "db">) {
  const rows = await db.all<{ id: number; prompt: string }>(sql`
    SELECT id, prompt FROM agent_configs
    WHERE prompt LIKE '%save_greeting%' OR prompt LIKE '%greeting%'
  `);
  for (const row of rows) {
    const prompt = row.prompt.replace(
      /\b(?:hello_save_greeting|save_greeting|greeting)\b/g,
      (identifier) => ({
        hello_save_greeting: "hello_save_a_j_oker",
        save_greeting: "save_a_j_oker",
        greeting: "aJoker",
      })[identifier]!,
    );
    if (prompt !== row.prompt)
      await db.run(sql`
        UPDATE agent_configs
        SET prompt = ${prompt}, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE id = ${row.id}
      `);
  }
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const turnTables = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('greetings', 'a_j_oker')`,
  );
  const hasOldTurns = turnTables.some((row) => row.name === "greetings");
  const hasNewTurns = turnTables.some((row) => row.name === "a_j_oker");
  if (hasOldTurns === hasNewTurns)
    throw new Error("a-j-oker physical rename is ambiguous; inspect the backup before continuing");
  if (hasOldTurns) await db.run(sql`ALTER TABLE \`greetings\` RENAME TO \`a_j_oker\``);

  const turnColumns = await db.all<{ name: string }>(sql`PRAGMA table_info(a_j_oker)`);
  const hasOldResponse = turnColumns.some((row) => row.name === "greeting");
  const hasNewResponse = turnColumns.some((row) => row.name === "a_joker");
  if (hasOldResponse === hasNewResponse)
    throw new Error("a-j-oker response column rename is ambiguous; inspect the backup before continuing");
  if (hasOldResponse)
    await db.run(sql`ALTER TABLE \`a_j_oker\` RENAME COLUMN \`greeting\` TO \`a_joker\``);

  const relationColumns = await db.all<{ name: string }>(
    sql`PRAGMA table_info(payload_locked_documents_rels)`,
  );
  if (relationColumns.some((row) => row.name === "greetings_id")) {
    await db.run(
      sql`ALTER TABLE \`payload_locked_documents_rels\` RENAME COLUMN \`greetings_id\` TO \`a_j_oker_id\``,
    );
  }

  for (const index of [
    "greetings_owner_idx",
    "greetings_session_id_idx",
    "greetings_request_key_idx",
    "greetings_updated_at_idx",
    "greetings_created_at_idx",
    "a_j_oker_owner_idx",
    "a_j_oker_session_id_idx",
    "a_j_oker_request_key_idx",
    "a_j_oker_updated_at_idx",
    "a_j_oker_created_at_idx",
    "payload_locked_documents_rels_greetings_id_idx",
    "payload_locked_documents_rels_a_j_oker_id_idx",
  ])
    await db.run(sql.raw(`DROP INDEX IF EXISTS \`${index}\``));
  await db.run(sql`CREATE INDEX \`a_j_oker_owner_idx\` ON \`a_j_oker\` (\`owner\`)`);
  await db.run(sql`CREATE INDEX \`a_j_oker_session_id_idx\` ON \`a_j_oker\` (\`session_id\`)`);
  await db.run(sql`CREATE UNIQUE INDEX \`a_j_oker_request_key_idx\` ON \`a_j_oker\` (\`request_key\`)`);
  await db.run(sql`CREATE INDEX \`a_j_oker_updated_at_idx\` ON \`a_j_oker\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX \`a_j_oker_created_at_idx\` ON \`a_j_oker\` (\`created_at\`)`);
  await db.run(
    sql`CREATE INDEX \`payload_locked_documents_rels_a_j_oker_id_idx\` ON \`payload_locked_documents_rels\` (\`a_j_oker_id\`)`,
  );

  // The specialist column has a strict SpecialistState schema and contains no
  // response protocol property; its prompt/current task strings must not be rewritten.
  await renameJsonKeys({ db }, "adk_sessions", "snapshot", renameAdkSnapshot);
  await renameJsonKeys({ db }, "a2a_execution_tasks", "snapshot", renameA2ASnapshot);
  await renameJsonKeys({ db }, "safety_evaluations", "output", renameSafetyEvaluationOutput);
  await renameAgentConfigPrompts({ db });
}

export async function down(): Promise<void> {
  throw new Error("已保存的生成轮次和执行快照不可自动丢弃；请先完成备份并制定数据转换方案。");
}
