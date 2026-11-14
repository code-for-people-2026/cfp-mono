import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeechSession, type SpeechEvents } from "./speech";

function setup() {
  let events: SpeechEvents | undefined;
  const driver = {
    start: vi.fn((value: SpeechEvents) => {
      events = value;
    }),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const callbacks = { phase: vi.fn(), result: vi.fn(), error: vi.fn() };
  return {
    driver,
    callbacks,
    session: createSpeechSession(driver, callbacks),
    events: () => events!,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("speech session", () => {
  it("cancels while authorization is pending and rejects a late start", () => {
    const { session, driver, callbacks, events } = setup();
    session.start();
    session.cancel();
    expect(driver.dispose).toHaveBeenCalledOnce();
    events().started();
    events().finished("不应该收到");
    expect(callbacks.result).not.toHaveBeenCalled();
    expect(callbacks.phase).toHaveBeenLastCalledWith("idle");
  });

  it("starts once per gesture and emits one trimmed result", () => {
    const { driver, callbacks, session, events } = setup();
    session.start();
    session.start();
    expect(driver.start).toHaveBeenCalledTimes(1);
    events().started();
    session.stop();
    expect(driver.stop).toHaveBeenCalledOnce();
    events().finished(" 今天有点累 ");
    events().finished("重复回调");
    expect(callbacks.result).toHaveBeenCalledOnce();
    expect(callbacks.result).toHaveBeenCalledWith("今天有点累");
  });

  it("stops immediately after a late start when the pointer was released first", () => {
    const { session, driver, events } = setup();
    session.start();
    session.stop();
    expect(driver.stop).not.toHaveBeenCalled();
    events().started();
    expect(driver.stop).toHaveBeenCalledOnce();
    session.dispose();
  });

  it("releases the microphone after the stop and hard timeouts", () => {
    vi.useFakeTimers();
    const { session, driver, callbacks, events } = setup();
    session.start();
    events().started();
    vi.advanceTimersByTime(60_000);
    expect(driver.stop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);
    expect(driver.dispose).toHaveBeenCalledOnce();
    expect(callbacks.error).toHaveBeenCalledWith(
      expect.stringContaining("超时"),
    );
    events().finished("超时后的文字");
    expect(callbacks.result).not.toHaveBeenCalled();
  });
});
