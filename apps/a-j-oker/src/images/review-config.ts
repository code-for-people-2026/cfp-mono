// Readiness and provider calls must agree on the exact credentials they use.
// Trim deployment-file padding; embedded whitespace/control/non-ASCII bytes
// cannot form these provider credentials or a single HTTP authorization token.
function credential(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && /^[\x21-\x7E]+$/.test(normalized) ? normalized : undefined;
}

export function greenReviewCredentials() {
  const accessKeyId = credential(process.env.HELLO_GREEN_ACCESS_KEY_ID);
  const accessKeySecret = credential(process.env.HELLO_GREEN_ACCESS_KEY_SECRET);
  return accessKeyId && accessKeySecret ? { accessKeyId, accessKeySecret } : undefined;
}

export function proxyReviewConfiguration() {
  const token = credential(process.env.HELLO_IMAGE_REVIEW_TOKEN);
  if (!token || !process.env.HELLO_IMAGE_REVIEW_URL) return undefined;
  try {
    const url = new URL(process.env.HELLO_IMAGE_REVIEW_URL);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return { url: url.toString(), token };
  } catch { return undefined; }
}
