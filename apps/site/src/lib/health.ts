type HealthPayload = {
  ok: true;
  service: string;
  timestamp: string;
};

export function createHealthPayload(service: string): HealthPayload {
  return {
    ok: true,
    service,
    timestamp: new Date(0).toISOString()
  };
}
