import { getChatPage, getHomepage, getSiteSettings, getUiStrings } from "@/lib/content";
import { DialogueChat } from "../shared/dialogue-chat";

export const dynamic = "force-dynamic";

export default async function DialoguePage({
  searchParams,
}: {
  searchParams: Promise<{ question?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.question) ? params.question[0] : params.question;
  const initialQuestion = raw?.slice(0, 1000);

  const [chat, ui, home, settings] = await Promise.all([
    getChatPage(),
    getUiStrings(),
    getHomepage(),
    getSiteSettings(),
  ]);

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_12%,var(--glow-cyan),transparent_34%),radial-gradient(circle_at_18%_82%,var(--glow-red),transparent_26%),radial-gradient(circle_at_84%_78%,var(--glow-gold),transparent_24%)]" />
      <DialogueChat
        initialQuestion={initialQuestion}
        content={{
          heading: chat.heading,
          intro: chat.intro,
          suggestions: home.dialogueSuggestions,
          brand: settings.brand,
          ui,
        }}
      />
    </main>
  );
}
