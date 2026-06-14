type MiniappDemoPayload = {
  message: string;
  source: "payload-site-api";
};

export function createDemoPayload(): MiniappDemoPayload {
  return {
    message: "码成工 API 已连接",
    source: "payload-site-api"
  };
}
