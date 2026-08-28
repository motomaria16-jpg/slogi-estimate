import assert from 'node:assert/strict';
import test from 'node:test';
import { GeocodeAddressService, GeocodeServiceError } from './service.ts';

function providerPayload(lng = 37.36, lat = 55.84) {
  return { response: { GeoObjectCollection: { featureMember: [{ GeoObject: { Point: { pos: `${lng} ${lat}` }, metaDataProperty: { GeocoderMetaData: { precision: 'exact', Address: { formatted: 'Москва, тестовый адрес, 1' } } } } }] } } };
}

function response(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

test('server geocoder caches normalized duplicate addresses', async () => {
  let calls = 0;
  const service = new GeocodeAddressService({ minProviderIntervalMs: 0, fetchImpl: async () => { calls += 1; return response(200, providerPayload()); } });
  const first = await service.geocode({ address: 'Москва, Тверская, 1', apiKey: 'test', clientKey: 'client' });
  const second = await service.geocode({ address: '  москва,   тверская, 1 ', apiKey: 'test', clientKey: 'client' });
  assert.equal(calls, 1);assert.equal(first.results.length, 1);assert.equal(first.diagnostic.cacheHit, false);assert.equal(second.diagnostic.cacheHit, true);
});

test('server geocoder retries a transient provider response with backoff', async () => {
  let calls = 0;const sleeps: number[] = [];
  const service = new GeocodeAddressService({ minProviderIntervalMs: 0, baseBackoffMs: 25, sleep: async value => { sleeps.push(value); }, fetchImpl: async () => { calls += 1; return calls === 1 ? response(503, {}) : response(200, providerPayload()); } });
  const result = await service.geocode({ address: 'Москва, Тверская, 2', apiKey: 'test', clientKey: 'client' });
  assert.equal(calls, 2);assert.deepEqual(sleeps, [25]);assert.equal(result.diagnostic.attempts, 2);
});

test('server geocoder returns an explicit timeout after bounded attempts', async () => {
  const service = new GeocodeAddressService({ timeoutMs: 10, maxAttempts: 1, minProviderIntervalMs: 0, fetchImpl: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => { const error = new Error('aborted');error.name = 'AbortError';reject(error); }, { once: true })) });
  await assert.rejects(() => service.geocode({ address: 'Москва, Тверская, 3', apiKey: 'test', clientKey: 'client' }), (error: unknown) => error instanceof GeocodeServiceError && error.code === 'geocoder_provider_timeout' && error.status === 504);
});

test('per-client rate limit rejects a distinct uncached request with Retry-After', async () => {
  let calls = 0;const service = new GeocodeAddressService({ clientRateLimit: 1, minProviderIntervalMs: 0, fetchImpl: async () => { calls += 1;return response(200, providerPayload()); } });
  await service.geocode({ address: 'Москва, Тверская, 4', apiKey: 'test', clientKey: 'client' });
  await assert.rejects(() => service.geocode({ address: 'Москва, Тверская, 5', apiKey: 'test', clientKey: 'client' }), (error: unknown) => error instanceof GeocodeServiceError && error.code === 'geocoder_rate_limited' && error.status === 429 && Number(error.retryAfterSeconds) >= 1);
  assert.equal(calls, 1);
});
