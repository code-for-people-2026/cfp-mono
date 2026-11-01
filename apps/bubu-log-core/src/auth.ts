import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { getCore } from "./client";
// Preserve the original username/email + bcrypt proof; expose no OAuth or registration paths.
export const { handlers } = NextAuth({
  secret: process.env.AUTH_SECRET, trustHost: true, session: { strategy: "jwt", maxAge: 300 },
  providers: [Credentials({ credentials: { username: {}, password: {} }, async authorize(input) {
    if (typeof input.username !== "string" || typeof input.password !== "string" || !input.username.trim() || input.username.length > 320 || !input.password || input.password.length > 256) return null;
    const payload = await getCore();
    const result = await payload.find({ collection: "app-users", where: { or: [{ username: { equals: input.username.trim() } }, { email: { equals: input.username.trim().toLowerCase() } }] }, limit: 1, depth: 0, overrideAccess: true });
    const user = result.docs[0];
    if (!user || typeof user.password !== "string" || !await bcrypt.compare(input.password, user.password)) return null;
    return { id: String(user.id) };
  } })],
  callbacks: {
    async jwt({ token, user }) { if (user) token.id = user.id; return token; },
    async session({ session, token }) { if (session.user && typeof token.id === "string") session.user.id = token.id; return session; },
  },
  logger: { error: () => console.error("bubu_core_auth_failed"), warn: () => {}, debug: () => {} },
});
