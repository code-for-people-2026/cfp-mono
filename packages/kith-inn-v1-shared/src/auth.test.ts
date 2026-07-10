import { describe, expect, it } from "vitest";
import {
  OPERATOR_TOKEN_TTL_SECONDS,
  SELECTION_TOKEN_TTL_SECONDS,
  issueOperatorSelectionToken,
  issueOperatorToken,
  operatorClaimsSchema,
  operatorSelectionClaimsSchema,
  verifyOperatorSelectionToken,
  verifyOperatorToken
} from "./auth";

const SECRET = "v1-test-secret";
const NOW = 1_800_000_000;

describe("operator token", () => {
  it("issues and verifies a seven-day single-seller token", async () => {
    const token = await issueOperatorToken({ operatorId: 3, sellerId: "seller-7" }, SECRET, NOW);
    await expect(verifyOperatorToken(token, SECRET, NOW)).resolves.toEqual({
      kind: "operator",
      operatorId: 3,
      sellerId: "seller-7",
      role: "operator",
      iat: NOW,
      exp: NOW + OPERATOR_TOKEN_TTL_SECONDS
    });
  });

  it("uses the current clock by default", async () => {
    const token = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET);
    const claims = await verifyOperatorToken(token, SECRET);
    expect(claims?.kind).toBe("operator");
    expect(claims!.exp - claims!.iat).toBe(OPERATOR_TOKEN_TTL_SECONDS);
  });

  it("rejects expiry, a tampered signature and malformed input", async () => {
    const token = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET, NOW);
    await expect(verifyOperatorToken(token, SECRET, NOW + OPERATOR_TOKEN_TTL_SECONDS)).resolves.toBeNull();
    await expect(verifyOperatorToken(`${token.slice(0, -1)}x`, SECRET, NOW)).resolves.toBeNull();
    await expect(verifyOperatorToken("not-a-jwt", SECRET, NOW)).resolves.toBeNull();
    await expect(verifyOperatorToken("%.payload.signature", SECRET, NOW)).resolves.toBeNull();
    await expect(verifyOperatorToken("e30.bm90LWpzb24.invalid", SECRET, NOW)).resolves.toBeNull();
  });
});

describe("operator selection token", () => {
  const choices = [
    { operatorId: 3, sellerId: 7 },
    { operatorId: "operator-4", sellerId: "seller-8" }
  ];

  it("issues and verifies a five-minute multi-seller token", async () => {
    const token = await issueOperatorSelectionToken(choices, SECRET, NOW);
    await expect(verifyOperatorSelectionToken(token, SECRET, NOW)).resolves.toEqual({
      kind: "operator-selection",
      choices,
      iat: NOW,
      exp: NOW + SELECTION_TOKEN_TTL_SECONDS
    });
  });

  it("keeps selection and operator token kinds isolated", async () => {
    const selection = await issueOperatorSelectionToken(choices, SECRET, NOW);
    const operator = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET, NOW);
    await expect(verifyOperatorToken(selection, SECRET, NOW)).resolves.toBeNull();
    await expect(verifyOperatorSelectionToken(operator, SECRET, NOW)).resolves.toBeNull();
  });

  it("rejects fewer than two choices and an empty secret", async () => {
    await expect(issueOperatorSelectionToken([choices[0]!], SECRET, NOW)).rejects.toThrow();
    await expect(issueOperatorSelectionToken(choices, "", NOW)).rejects.toThrow(/secret/i);
    await expect(issueOperatorToken({ operatorId: 3, sellerId: 7 }, "", NOW)).rejects.toThrow(/secret/i);
    await expect(verifyOperatorSelectionToken("a.b.c", "", NOW)).resolves.toBeNull();
  });
});

describe("claims schemas", () => {
  it("rejects invalid ids, roles, timestamps, extra fields and inverted expiry", () => {
    expect(operatorClaimsSchema.safeParse({
      kind: "operator",
      operatorId: "",
      sellerId: 7,
      role: "owner",
      iat: NOW,
      exp: NOW - 1,
      openid: "must-not-leak"
    }).success).toBe(false);
    expect(operatorSelectionClaimsSchema.safeParse({
      kind: "operator-selection",
      choices: [{ operatorId: 1, sellerId: 2 }],
      iat: -1,
      exp: NOW
    }).success).toBe(false);
  });
});
