import assert from 'node:assert/strict';
import test from 'node:test';
import { SerperSearchMethod } from '../src/methods/serper.js';

test('Serper requires caller-owned environment configuration', async (t) => {
  const originalKey = process.env.SERPER_API_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = originalKey;
  });

  delete process.env.SERPER_API_KEY;
  const missing = new SerperSearchMethod();
  assert.equal(missing.isAvailable, false);
  await assert.rejects(missing.execute({ query: 'example' }), /SERPER_API_KEY/);

  process.env.SERPER_API_KEY = '  ';
  assert.equal(new SerperSearchMethod().isAvailable, false);

  process.env.SERPER_API_KEY = ' test-only-placeholder ';
  const configured = new SerperSearchMethod();
  assert.equal(configured.isAvailable, true);
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('X-API-KEY'), 'test-only-placeholder');
    return new Response(JSON.stringify({ organic: [{
      title: 'Example', link: 'https://example.org', snippet: 'Public sample', position: 1,
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const results = await configured.execute({ query: 'example' });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(results[0]?.filePath, 'https://example.org');

  fetchMock.mock.mockImplementation(async () => new Response('provider-private-detail', { status: 403 }));
  const logMock = t.mock.method(console, 'error', () => {});
  assert.deepEqual(await configured.execute({ query: 'example' }), []);
  assert.deepEqual(logMock.mock.calls[0]?.arguments, ['[Serper] HTTP 403']);
});
