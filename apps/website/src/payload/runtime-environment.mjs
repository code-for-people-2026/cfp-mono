const postgresEnvironmentNames = [
  "PAYLOAD_DATABASE_URL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
];

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function nonBlank(value) {
  return value?.trim() ? value : undefined;
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function asPostgresURL(value) {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    const hasPostgresProtocol =
      parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
    return hasPostgresProtocol && parsed.hostname ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {{ payloadSecret: string | undefined; postgresDatabaseURL: string | undefined }}
 */
export function resolvePayloadRuntimeEnvironment(environment = process.env) {
  const payloadSecret = nonBlank(environment.PAYLOAD_SECRET);
  const configuredDatabaseURL = postgresEnvironmentNames
    .map((name) => nonBlank(environment[name]))
    .find(Boolean);
  const databaseURI = nonBlank(environment.DATABASE_URI);
  const databaseURL = configuredDatabaseURL || databaseURI;
  const postgresDatabaseURL = asPostgresURL(databaseURL);

  const isVercelDeployment = environment.VERCEL === "1" || environment.VERCEL === "true";
  const isSelfHostedProductionRuntime =
    environment.NODE_ENV === "production" && environment.CFP_WEBSITE_BUILD !== "1";
  const requiresProductionEnvironment =
    isVercelDeployment || isSelfHostedProductionRuntime;

  if (requiresProductionEnvironment && !payloadSecret) {
    throw new Error("PAYLOAD_SECRET is required for production Payload runtimes.");
  }

  if (requiresProductionEnvironment && !postgresDatabaseURL) {
    throw new Error("A Postgres database URL is required for production Payload runtimes.");
  }

  return { payloadSecret, postgresDatabaseURL };
}
