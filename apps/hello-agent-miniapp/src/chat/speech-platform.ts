import Taro from "@tarojs/taro";
import type { SpeechDriver, SpeechEvents } from "./speech";

interface WechatRecognition {
  start(options: { lang: "zh_CN"; duration: number }): void;
  stop(): void;
  onStart: () => void;
  onStop: (result: { result: string }) => void;
  onError: () => void;
}
interface WechatSpeechPlugin {
  getRecordRecognitionManager(): WechatRecognition;
}
interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  }
}

export function createPlatformSpeechDriver(): SpeechDriver {
  if (process.env.TARO_ENV === "weapp") return createWechatDriver();
  return createBrowserDriver();
}

// 插件管理器是全局单例；切到键盘再返回，也必须等上一条录音真正结束。
let wechatSpeechDraining = false;
function createWechatDriver(): SpeechDriver {
  let manager: WechatRecognition | undefined;
  let active = false;
  let revision = 0;
  let recording = false;
  return {
    start(events: SpeechEvents) {
      if (!HELLO_WECHAT_SI_ENABLED)
        throw new Error("小程序语音尚未开通，请先切换键盘输入。");
      if (wechatSpeechDraining)
        throw new Error("上一段录音仍在结束，请稍后再试或切换键盘。");
      // 微信插件没有官方 TS 包：边界仅声明实际使用的接口，不向业务层传播 any。
      const plugin: WechatSpeechPlugin = Taro.requirePlugin("WechatSI");
      manager = plugin.getRecordRecognitionManager();
      const current = manager;
      const run = ++revision;
      active = true;
      current.onStart = () => {
        if (active) events.started();
      };
      current.onStop = ({ result }) => {
        recording = false;
        if (active) events.finished(result);
      };
      current.onError = () => {
        recording = false;
        if (active)
          events.failed("语音识别未完成，请检查麦克风权限和网络，或切换键盘。");
      };
      void Taro.authorize({ scope: "scope.record" }).then(
        () => {
          if (!active || run !== revision) return;
          try {
            recording = true;
            current.start({ lang: "zh_CN", duration: 60_000 });
          } catch {
            recording = false;
            events.failed("语音未能启动，请切换键盘后重试。");
          }
        },
        () => {
          if (active && run === revision)
            events.failed(
              "未获得麦克风权限，可在小程序设置中开启，或使用键盘输入。",
            );
        },
      );
    },
    stop() {
      manager?.stop();
    },
    dispose() {
      active = false;
      revision++;
      if (!manager) return;
      manager.onStart = () => {
        manager?.stop();
      };
      manager.onStop = manager.onError = () => {
        recording = false;
        wechatSpeechDraining = false;
      };
      if (recording) {
        wechatSpeechDraining = true;
        try {
          manager.stop();
        } catch {
          /* 仍须等平台结束回调，不能混入下一次录音。 */
        }
      }
    },
  };
}

function createBrowserDriver(): SpeechDriver {
  let recognition: BrowserRecognition | undefined;
  return {
    start(events) {
      const Recognition =
        typeof window === "undefined"
          ? undefined
          : window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition)
        throw new Error(
          "这个浏览器暂不支持语音识别，请切换键盘，也可使用手机输入法的语音键。",
        );
      if (!window.isSecureContext)
        throw new Error("语音输入需要 HTTPS 或本机 localhost，请先使用键盘。");
      recognition = new Recognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = false;
      let transcript = "";
      recognition.onstart = events.started;
      recognition.onresult = ({ results }) => {
        transcript = Array.from(
          results,
          (result) => result[0]?.transcript || "",
        ).join("");
      };
      recognition.onend = () => events.finished(transcript);
      recognition.onerror = ({ error }) =>
        events.failed(
          error === "not-allowed" || error === "service-not-allowed"
            ? "麦克风或语音服务未获授权，请检查浏览器权限，或切换键盘。"
            : "语音识别未完成，请检查网络后重试，或切换键盘。",
        );
      recognition.start();
    },
    stop() {
      recognition?.stop();
    },
    dispose() {
      if (!recognition) return;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
      recognition = undefined;
    },
  };
}
