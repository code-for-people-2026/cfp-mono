import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeechSession, type SpeechEvents } from "../src/chat/speech";

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
describe("语音输入生命周期", () => {
  it("授权等待中取消会立即释放，迟到的启动不能录入文字", () => {
    const { session, driver, callbacks, events } = setup();
    session.start();
    session.cancel();
    expect(driver.dispose).toHaveBeenCalledOnce();
    events().started();
    events().finished("不应该收到");
    expect(callbacks.result).not.toHaveBeenCalled();
    expect(callbacks.phase).toHaveBeenLastCalledWith("idle");
  });
  it("按下才开始，松开停止；最终结果只交给草稿一次", () => {
    const { driver, callbacks, session, events } = setup();
    expect(driver.start).not.toHaveBeenCalled();
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
    expect(callbacks.phase).toHaveBeenLastCalledWith("idle");
  });
  it("授权尚未结束时松手，启动后立即停止，不偷偷继续录音", () => {
    const { session, driver, events } = setup();
    session.start();
    session.stop();
    expect(driver.stop).not.toHaveBeenCalled();
    events().started();
    expect(driver.stop).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("取消后忽略结果，结束前不允许开始另一条", () => {
    const { session, callbacks, driver, events } = setup();
    session.start();
    events().started();
    session.cancel();
    session.start();
    expect(driver.start).toHaveBeenCalledOnce();
    events().finished("不能写入的文字");
    expect(callbacks.result).not.toHaveBeenCalled();
    session.start();
    expect(driver.start).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it("卸载时释放麦克风，迟到的成功和错误都不更新界面", () => {
    const { session, callbacks, driver, events } = setup();
    session.start();
    session.dispose();
    const count = callbacks.phase.mock.calls.length;
    events().started();
    events().finished("迟到");
    events().failed("迟到错误");
    expect(driver.dispose).toHaveBeenCalledOnce();
    expect(callbacks.result).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(callbacks.phase).toHaveBeenCalledTimes(count);
  });
  it("60 秒自动结束、15 秒等待超时后释放且不提交半句", () => {
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
  it("空识别和权限拒绝都给出可恢复提示", () => {
    const { session, events, callbacks } = setup();
    session.start();
    events().finished("  ");
    expect(callbacks.error).toHaveBeenLastCalledWith(
      expect.stringContaining("没有听清"),
    );
    session.start();
    events().failed("未授权");
    expect(callbacks.error).toHaveBeenLastCalledWith("未授权");
    expect(callbacks.result).not.toHaveBeenCalled();
  });
});
