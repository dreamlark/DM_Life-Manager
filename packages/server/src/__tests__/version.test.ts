import { describe, it, expect } from 'vitest';
import { getVersionInfo, SCHEMA_VERSION, SERVER_VERSION } from '../version';

describe('协作后端版本契约（增量升级）', () => {
  it('getVersionInfo 返回 backend / minFrontend / schema 三段', () => {
    const v = getVersionInfo();
    expect(v.backend).toBe(SERVER_VERSION);
    expect(typeof v.minFrontend).toBe('string');
    expect(v.schema).toBe(SCHEMA_VERSION);
    expect(typeof v.schema).toBe('number');
  });
});
