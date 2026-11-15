import { describe, expect, it } from 'vitest';
import { resolveWeappProfile, resolveH5DevProxy } from '../config/profiles';
describe('fixed build profiles', () => {
  it('defaults to local development and pins experience', () => {
    expect(resolveWeappProfile({}).apiOrigin).toBe('http://127.0.0.1:3320');
    expect(resolveWeappProfile({ BUBU_API_PROFILE: 'experience' }).apiOrigin).toBe('https://bubu-preview.codeforpeople.cn');
    expect(resolveH5DevProxy({})).toBe('http://127.0.0.1:3320');
  });
  it('rejects unknown profiles, conflicting origins and remote H5 development proxies', () => {
    expect(() => resolveWeappProfile({ BUBU_API_PROFILE: 'prod' })).toThrow();
    expect(() => resolveWeappProfile({ BUBU_API_ORIGIN: 'https://bubu-preview.codeforpeople.cn' })).toThrow();
    expect(() => resolveH5DevProxy({ BUBU_DEV_PROXY: 'https://bubu-preview.codeforpeople.cn' })).toThrow();
  });
});
