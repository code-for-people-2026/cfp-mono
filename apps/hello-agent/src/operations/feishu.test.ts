import { describe, expect, it, vi } from "vitest";
import { feishuConfig, feishuMessage, sendFeishu } from "./feishu";
const env = { HELLO_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-only", HELLO_FEISHU_SIGNING_SECRET: "synthetic-signing-secret", HELLO_ORIGIN: "https://example.invalid", HELLO_FEISHU_ALERTS_ENABLED: "true" };
const config = feishuConfig(env)!;
const target = { caseId: 12, receipt: "4f9fc714-0852-408c-b8c6-7f181838a76e" };
describe("飞书值守提醒", () => {
  it("只允许飞书中国站固定协议，阻止凭据重定向和任意地址", () => {
    for (const url of ["http://open.feishu.cn/open-apis/bot/v2/hook/key", "https://open.feishu.cn.attacker.test/open-apis/bot/v2/hook/key", "https://user:pass@open.feishu.cn/open-apis/bot/v2/hook/key", "https://127.0.0.1/key", `${env.HELLO_FEISHU_WEBHOOK}?token=test`, `${env.HELLO_FEISHU_WEBHOOK}#test`])
      expect(feishuConfig({ ...env, HELLO_FEISHU_WEBHOOK: url })).toBeNull();
    expect(feishuConfig({ ...env, HELLO_FEISHU_SIGNING_SECRET: "" })).toBeNull();
    expect(feishuConfig({ ...env, HELLO_ORIGIN: "https://example.invalid/path?token=secret" })).toBeNull();
  });
  it("配置变化使原收件验证失效，默认不启用发送", () => {
    expect(feishuConfig({ ...env, HELLO_FEISHU_SIGNING_SECRET: "another-synthetic-secret" })?.fingerprint).not.toBe(config.fingerprint);
    expect(feishuConfig({ ...env, HELLO_FEISHU_ALERTS_ENABLED: "" })?.enabled).toBe(false);
  });
  it("签名按官方空消息HMAC方式生成；仅编号、处理入口与@群成员离开服务端", () => {
    const privateRecord = { ...target, owner: "private-owner", text: "private-evidence", phone: "13800000000" };
    const value = feishuMessage(config, privateRecord, 1599360473000);
    expect(value.timestamp).toBe("1599360473");
    // Independently generated using Python hmac.new((timestamp + '\n' + secret).encode(), digestmod=hashlib.sha256).
    expect(value.sign).toBe("VqvSL8MoOhBIhiOJFWtWMTHcMpwIWVIP/dPXOKcYJCc=");
    expect(value.content.text).toContain("/admin/collections/safety-cases/12");
    expect(value.content.text).toContain('<at user_id="all">所有人</at>');
    expect(JSON.stringify(value)).not.toMatch(/private-owner|private-evidence|13800000000|synthetic-signing-secret/);
  });
  it.each([{ code: 0 }, { StatusCode: 0 }, { code: 0, StatusCode: 0 }])("仅明确成功码才记平台已接收：%o", async (body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    expect(await sendFeishu(config, target, request)).toEqual({ ok: true });
    expect(request.mock.calls[0][1]?.redirect).toBe("error");
  });
  it.each([{}, { code: "0" }, { StatusCode: 0, code: 19021 }])("HTTP 200不掩盖缺失/冲突结果：%o", async (body) => {
    expect((await sendFeishu(config, target, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)))).ok).toBe(false);
  });
  it("永久签名错误不盲目重试，限流和网络超时可以有限重试且不泄露响应", async () => {
    expect(await sendFeishu(config, target, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 19021, msg: env.HELLO_FEISHU_WEBHOOK })))).toEqual({ ok: false, code: "provider_19021", retryable: false });
    expect(await sendFeishu(config, target, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 11232 })))).toEqual({ ok: false, code: "provider_11232", retryable: true });
    expect(await sendFeishu(config, target, vi.fn<typeof fetch>().mockRejectedValue(new Error(env.HELLO_FEISHU_WEBHOOK)))).toEqual({ ok: false, code: "network_or_timeout", retryable: true });
  });
});
