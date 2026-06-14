const defaultAllowedOrigin = "http://localhost:3301";

export function getAllowedMiniappOrigin() {
  return process.env.MINIAPP_H5_ORIGIN || defaultAllowedOrigin;
}

export function createCorsHeaders(origin: string | null) {
  const allowedOrigin = getAllowedMiniappOrigin();
  const responseOrigin = origin === allowedOrigin ? origin : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

