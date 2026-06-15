"use client";

import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import { dialogueEntry, dialogueSuggestions } from "@/content/site";

export function DialogueEntry() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) return;

    const params = new URLSearchParams({ question: trimmed });
    router.push(`/dialogue?${params.toString()}`);
  }

  return (
    <section className="mx-auto mt-9 w-full max-w-3xl" aria-label="了解项目入口">
      <form
        onSubmit={submit}
        className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--composer)] text-left shadow-[var(--shadow-large)] backdrop-blur-xl transition-colors focus-within:border-[var(--ring)] focus-within:ring-4 focus-within:ring-[var(--ring-soft)]"
      >
        <div className="grid min-h-[148px] grid-cols-[minmax(0,1fr)_48px] gap-4 p-5 sm:p-6">
          <div>
            <p className="mb-3 text-sm font-semibold text-[var(--muted)]">
              {dialogueEntry.prompt}
            </p>
            <textarea
              aria-label="想了解的问题"
              className="min-h-[72px] w-full resize-none border-0 bg-transparent p-0 text-base leading-7 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]/75"
              maxLength={400}
              onChange={(event) => setValue(event.target.value)}
              placeholder={dialogueEntry.placeholder}
              rows={3}
              suppressHydrationWarning
              value={value}
            />
          </div>
          <button
            type="submit"
            aria-label={dialogueEntry.submitLabel}
            className="mt-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--ink)] text-[var(--bg)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!trimmed}
          >
            <Send aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--composer-footer)] px-4 py-4">
          <div className="flex flex-wrap justify-center gap-2">
            {dialogueSuggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                className="min-h-10 rounded-full border border-[var(--border)] bg-[var(--chip)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                onClick={() => setValue(suggestion.value)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
          <p className="mx-auto mt-3 max-w-xl text-center text-xs leading-5 text-[var(--muted)]">
            {dialogueEntry.note}
          </p>
        </div>
      </form>
    </section>
  );
}
