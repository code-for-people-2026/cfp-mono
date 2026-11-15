import { z } from "zod";

export const userProfileSchema = z.object({
  nickname: z.string().min(1).max(24),
  avatar: z.object({
    emoji: z.string().min(1).max(8),
    color: z.string().regex(/^#[a-f0-9]{6}$/),
    image: z.boolean(),
  }),
});
export type UserProfile = z.output<typeof userProfileSchema>;
