export type SpeechPhase =
  | "idle"
  | "starting"
  | "listening"
  | "transcribing"
  | "cancelling";

export interface SpeechEvents {
  started(): void;
  finished(text: string): void;
  failed(message: string): void;
}

export interface SpeechDriver {
  start(events: SpeechEvents): void;
  stop(): void;
  dispose(): void;
}

export interface SpeechCopy {
  noSpeech: string;
  stopFailed: string;
  timeout: string;
}

const defaultSpeechCopy: SpeechCopy = {
  noSpeech: "没有听清，再试一次，或切换键盘输入。",
  stopFailed: "录音未能完成，请重试或切换键盘。",
  timeout: "语音识别超时，请重试或切换键盘。",
};

// Every gesture owns a callback generation. Cancelled, timed-out, and unmounted
// late results must never write into the current draft.
export function createSpeechSession(
  driver: SpeechDriver,
  callbacks: {
    phase(value: SpeechPhase): void;
    result(text: string): void;
    error(message: string): void;
  },
  copy: Partial<SpeechCopy> = {},
) {
  const messages = { ...defaultSpeechCopy, ...copy };
  let phase: SpeechPhase = "idle";
  let alive = true;
  let generation = 0;
  let released = false;
  let cancelled = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const change = (value: SpeechPhase) => {
    phase = value;
    if (alive) callbacks.phase(value);
  };
  const finish = (text: string, error?: string) => {
    clearTimeout(timer);
    generation++;
    driver.dispose();
    change("idle");
    if (!alive || cancelled) return;
    if (error) callbacks.error(error);
    else if (text.trim()) callbacks.result(text.trim());
    else callbacks.error(messages.noSpeech);
  };
  const stop = () => {
    if (phase === "idle") return;
    if (released) {
      if (cancelled) change("cancelling");
      return;
    }
    released = true;
    const wasStarting = phase === "starting";
    change(cancelled ? "cancelling" : "transcribing");
    clearTimeout(timer);
    timer = setTimeout(() => finish("", messages.timeout), 15_000);
    if (!wasStarting) {
      try {
        driver.stop();
      } catch {
        finish("", messages.stopFailed);
      }
    }
  };

  return {
    start() {
      if (!alive || phase !== "idle") return;
      released = false;
      cancelled = false;
      started = false;
      const current = ++generation;
      change("starting");
      timer = setTimeout(stop, 60_000);
      try {
        driver.start({
          started() {
            if (!alive || current !== generation) return;
            started = true;
            if (released) {
              try {
                driver.stop();
              } catch {
                finish("", messages.stopFailed);
              }
            } else change("listening");
          },
          finished(text) {
            if (alive && current === generation) finish(text);
          },
          failed(message) {
            if (alive && current === generation) finish("", message);
          },
        });
      } catch (error) {
        finish(
          "",
          error instanceof Error ? error.message : messages.stopFailed,
        );
      }
    },
    stop,
    cancel() {
      if (phase === "idle") return;
      cancelled = true;
      if (!started) finish("");
      else stop();
    },
    dispose() {
      alive = false;
      generation++;
      clearTimeout(timer);
      driver.dispose();
    },
  };
}
