"use client";

import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import type { DialogueEntry as DialogueEntryContent, DialogueSuggestion } from "@/lib/content/types";

export function DialogueEntry({
  entry,
  suggestions,
}: {
  entry: DialogueEntryContent;
  suggestions: DialogueSuggestion[];
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const trimmed = value.trim();

  // Prefetch the chat route so the first navigation doesn't pay for the route
  // chunk + RSC round-trip on click.
  useEffect(() => {
    router.prefetch("/chat");
  }, [router]);

  function openConversation(question: string) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;

    const params = new URLSearchParams({ question: normalizedQuestion });
    startTransition(() => {
      router.push(`/chat?${params.toString()}`);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openConversation(trimmed);
  }

  return (
    <section className="mx-auto mt-9 w-full max-w-3xl" aria-label="了解项目入口">
      <form
        onSubmit={submit}
        className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--composer)] text-left shadow-[var(--shadow-large)] backdrop-blur-xl transition-colors focus-within:border-[var(--ring)] focus-within:ring-4 focus-within:ring-[var(--ring-soft)]"
      >
        <div className="grid min-h-[148px] grid-cols-[minmax(0,1fr)_48px] gap-4 p-5 sm:p-6">
          <div>
            <p className="mb-3 text-sm font-semibold text-[var(--muted-foreground)]">
              {entry.prompt}
            </p>
            <textarea
              aria-label="想了解的问题"
              className="min-h-[72px] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--muted-foreground)]/75"
              maxLength={400}
              onChange={(event) => setValue(event.target.value)}
              placeholder={entry.placeholder}
              rows={3}
              suppressHydrationWarning
              value={value}
            />
          </div>
          <button
            type="submit"
            aria-label={entry.submitLabel}
            aria-busy={isPending}
            className="mt-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!trimmed || isPending}
          >
            {isPending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Send aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--composer-footer)] px-4 py-4">
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-center">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.label}
                type="button"
                className={
                  index === 0
                    ? "min-h-11 w-full rounded-lg border border-[var(--accent)] bg-[var(--ring-soft)] px-4 text-sm font-bold text-[var(--accent-strong)] shadow-[var(--shadow-soft)] transition-colors hover:bg-[var(--chip)] sm:w-auto"
                    : "min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--chip)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] sm:w-auto"
                }
                disabled={isPending}
                onClick={() => openConversation(suggestion.value)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-xl text-center text-xs leading-5 text-[var(--muted-foreground)]">
            {entry.note}
          </p>
        </div>
      </form>
    </section>
  );
}
