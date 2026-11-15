import { afterEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  accountRead: vi.fn(async () => ({})), accountDelete: vi.fn(async () => {}),
  familyRead: vi.fn(async () => ({})), familyDelete: vi.fn(async () => {}),
  mediaRead: vi.fn(async () => ([])), mediaWrite: vi.fn(async () => ({})),
}));
vi.mock('../src/client', () => ({getCore: async () => ({auth: async () => ({user:{collection:'cms-admins',email:'test@example.test'}})})}));
vi.mock('../src/lifecycle', () => ({
  LifecycleError: class extends Error {}, corePool: () => ({}), profileOwnersFromEnv: () => ({}),
  familyLifecycle: () => ({exportFamilyData:calls.familyRead,deleteFamilyData:calls.familyDelete}),
}));
vi.mock('../src/account-lifecycle', () => ({accountLifecycle: () => ({exportAccountData:calls.accountRead,deleteAccountData:calls.accountDelete})}));
vi.mock('../src/media', () => ({OriginalMediaReferences: class {inventory=calls.mediaRead;replace=calls.mediaWrite;}}));
import * as account from '../src/app/internal/account/route';
import * as family from '../src/app/internal/family/route';
import * as media from '../src/app/internal/media/route';
afterEach(() => {vi.unstubAllEnvs();vi.clearAllMocks();});
describe('Next automatic HEAD uses the read handler', () => {
  it.each(['false','true'])('cannot mutate even with valid internal credentials and writes=%s',async writes => {
    for (const [key,value] of Object.entries({BUBU_CORE_SERVICE_TOKEN:'a'.repeat(64),BUBU_CORE_DATABASE_URL:'postgresql://127.0.0.1/test',BUBU_CORE_PAYLOAD_SECRET:'b'.repeat(64),AUTH_SECRET:'c'.repeat(64),BUBU_CORE_CMS_EMAIL:'test@example.test',BUBU_CORE_WRITES_ENABLED:writes})) vi.stubEnv(key,value);
    for (const route of [account,family,media]) {
      const request = new Request('http://127.0.0.1:3321/internal/test?userId=a&babyId=b',{method:'HEAD',headers:{'x-bubu-core-token':'a'.repeat(64)}});
      expect((await route.GET(request)).status).toBe(200);
    }
    expect(calls.accountDelete).not.toHaveBeenCalled();expect(calls.familyDelete).not.toHaveBeenCalled();expect(calls.mediaWrite).not.toHaveBeenCalled();
    expect(calls.accountRead).toHaveBeenCalledOnce();expect(calls.familyRead).toHaveBeenCalledOnce();expect(calls.mediaRead).toHaveBeenCalledOnce();
    if (writes === 'false') for (const route of [account,family]) {
      const request = new Request('http://127.0.0.1:3321/internal/test?userId=a&babyId=b',{method:'DELETE',headers:{'x-bubu-core-token':'a'.repeat(64)}});
      expect((await route.DELETE(request)).status).toBe(503);
    }
    expect(calls.accountDelete).not.toHaveBeenCalled();expect(calls.familyDelete).not.toHaveBeenCalled();
  });
});
