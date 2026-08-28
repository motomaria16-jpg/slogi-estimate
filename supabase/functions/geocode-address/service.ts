export interface GeocodeResult {
  address: string;
  lng: number;
  lat: number;
  precision: string;
}

export interface GeocodeDiagnostic {
  status: 'ok' | 'not_found';
  cacheHit: boolean;
  attempts: number;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
  diagnostic: GeocodeDiagnostic;
}

interface CacheEntry {
  expiresAt: number;
  response: GeocodeResponse;
}

interface ServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  minProviderIntervalMs?: number;
  clientRateLimit?: number;
  clientRateWindowMs?: number;
  successTtlMs?: number;
  notFoundTtlMs?: number;
  cacheLimit?: number;
}

export class GeocodeServiceError extends Error {
  code: string;
  status: number;
  retryAfterSeconds: number | null;

  constructor(code: string, status: number, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'GeocodeServiceError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizeAddress(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
}

function retryAfterMilliseconds(response: Response, attempt: number, baseBackoffMs: number): number {
  const header = String(response.headers.get('retry-after') || '').trim();
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1_000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(10_000, date - Date.now()));
  return Math.min(5_000, baseBackoffMs * 2 ** Math.max(0, attempt - 1));
}

function parseResults(payload: unknown, fallbackAddress: string): GeocodeResult[] {
  const root = payload as Record<string, any> | null;
  const members = root?.response?.GeoObjectCollection?.featureMember;
  if (!Array.isArray(members)) return [];
  return members.map((item: Record<string, any>) => {
    const object = item?.GeoObject || {};
    const meta = object?.metaDataProperty?.GeocoderMetaData || {};
    const position = String(object?.Point?.pos || '').trim().split(/\s+/).map(Number);
    if (position.length < 2 || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) return null;
    return {
      address: String(meta?.Address?.formatted || meta?.text || [object?.description, object?.name].filter(Boolean).join(', ') || fallbackAddress),
      lng: position[0],
      lat: position[1],
      precision: String(meta?.precision || ''),
    };
  }).filter((item): item is GeocodeResult => item !== null);
}

export class GeocodeAddressService {
  private fetchImpl: typeof fetch;
  private now: () => number;
  private sleep: (milliseconds: number) => Promise<void>;
  private timeoutMs: number;
  private maxAttempts: number;
  private baseBackoffMs: number;
  private minProviderIntervalMs: number;
  private clientRateLimit: number;
  private clientRateWindowMs: number;
  private successTtlMs: number;
  private notFoundTtlMs: number;
  private cacheLimit: number;
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<GeocodeResponse>>();
  private clientWindows = new Map<string, number[]>();
  private nextProviderAt = 0;
  private providerSlot: Promise<void> = Promise.resolve();
  private nextRateSweepAt = 0;

  constructor(options: ServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = boundedInteger(options.timeoutMs, 8_000, 10, 30_000);
    this.maxAttempts = boundedInteger(options.maxAttempts, 3, 1, 5);
    this.baseBackoffMs = boundedInteger(options.baseBackoffMs, 250, 0, 5_000);
    this.minProviderIntervalMs = boundedInteger(options.minProviderIntervalMs, 120, 0, 5_000);
    this.clientRateLimit = boundedInteger(options.clientRateLimit, 120, 1, 1_000);
    this.clientRateWindowMs = boundedInteger(options.clientRateWindowMs, 60_000, 1_000, 3_600_000);
    this.successTtlMs = boundedInteger(options.successTtlMs, 7 * 24 * 60 * 60 * 1_000, 1_000, 30 * 24 * 60 * 60 * 1_000);
    this.notFoundTtlMs = boundedInteger(options.notFoundTtlMs, 10 * 60 * 1_000, 1_000, 24 * 60 * 60 * 1_000);
    this.cacheLimit = boundedInteger(options.cacheLimit, 2_000, 100, 20_000);
  }

  private cacheKey(address: string, ll: string, spn: string): string {
    return `${normalizeAddress(address)}|${String(ll || '').trim()}|${String(spn || '').trim()}`;
  }

  private cached(key: string): GeocodeResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.cache.delete(key); return null; }
    return { ...entry.response, diagnostic: { ...entry.response.diagnostic, cacheHit: true } };
  }

  private enforceClientRate(clientKey: string): void {
    const key = String(clientKey || 'anonymous').slice(0, 160);
    const threshold = this.now() - this.clientRateWindowMs;
    if (this.now() >= this.nextRateSweepAt) {
      for (const [candidate, stamps] of this.clientWindows) if (!stamps.some((stamp) => stamp > threshold)) this.clientWindows.delete(candidate);
      this.nextRateSweepAt = this.now() + this.clientRateWindowMs;
    }
    const current = (this.clientWindows.get(key) || []).filter((stamp) => stamp > threshold);
    if (current.length >= this.clientRateLimit) {
      const retryAfter = Math.max(1, Math.ceil((current[0] + this.clientRateWindowMs - this.now()) / 1_000));
      this.clientWindows.set(key, current);
      throw new GeocodeServiceError('geocoder_rate_limited', 429, retryAfter);
    }
    current.push(this.now());
    this.clientWindows.set(key, current);
  }

  private storeCache(key: string, entry: CacheEntry): void {
    if (this.cache.size >= this.cacheLimit) {
      const current = this.now();
      for (const [candidate, cached] of this.cache) if (cached.expiresAt <= current) this.cache.delete(candidate);
      while (this.cache.size >= this.cacheLimit) { const oldest = this.cache.keys().next().value as string | undefined;if (oldest == null) break;this.cache.delete(oldest); }
    }
    this.cache.set(key, entry);
  }

  private async acquireProviderSlot(): Promise<void> {
    let release = () => {};
    const previous = this.providerSlot;
    this.providerSlot = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const delay = Math.max(0, this.nextProviderAt - this.now());
      if (delay) await this.sleep(delay);
      this.nextProviderAt = this.now() + this.minProviderIntervalMs;
    } finally { release(); }
  }

  private async providerRequest(address: string, apiKey: string, ll: string, spn: string, referer: string): Promise<GeocodeResponse> {
    let lastCode = 'geocoder_provider_failed';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.acquireProviderSlot();
      const url = new URL('https://geocode-maps.yandex.ru/v1/');
      url.searchParams.set('apikey', apiKey);
      url.searchParams.set('geocode', address);
      url.searchParams.set('lang', 'ru_RU');
      url.searchParams.set('format', 'json');
      url.searchParams.set('results', '10');
      url.searchParams.set('rspn', '0');
      if (ll) url.searchParams.set('ll', ll);
      if (spn) url.searchParams.set('spn', spn);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (referer) headers.Referer = referer.endsWith('/') ? referer : `${referer}/`;
        const response = await this.fetchImpl(url.toString(), { headers, signal: controller.signal });
        let payload: unknown = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (response.ok) {
          const results = parseResults(payload, address);
          return { results, diagnostic: { status: results.length ? 'ok' : 'not_found', cacheHit: false, attempts: attempt } };
        }
        lastCode = response.status === 429 ? 'geocoder_provider_rate_limited' : response.status === 408 || response.status === 504 ? 'geocoder_provider_timeout' : 'geocoder_provider_failed';
        if (attempt < this.maxAttempts && (response.status === 429 || response.status === 408 || response.status >= 500)) {
          await this.sleep(retryAfterMilliseconds(response, attempt, this.baseBackoffMs));
          continue;
        }
        throw new GeocodeServiceError(lastCode, response.status === 429 ? 429 : response.status === 408 || response.status === 504 ? 504 : 502);
      } catch (error) {
        if (error instanceof GeocodeServiceError) throw error;
        lastCode = timedOut || (error instanceof Error && error.name === 'AbortError') ? 'geocoder_provider_timeout' : 'geocoder_provider_failed';
        if (attempt < this.maxAttempts) { await this.sleep(this.baseBackoffMs * 2 ** Math.max(0, attempt - 1)); continue; }
        throw new GeocodeServiceError(lastCode, lastCode === 'geocoder_provider_timeout' ? 504 : 502);
      } finally { clearTimeout(timer); }
    }
    throw new GeocodeServiceError(lastCode, 502);
  }

  async geocode(input: { address: string; apiKey: string; ll?: string; spn?: string; clientKey?: string; referer?: string }): Promise<GeocodeResponse> {
    const address = String(input.address || '').trim();
    if (address.length < 5) throw new GeocodeServiceError('geocoder_address_invalid', 400);
    if (!String(input.apiKey || '').trim()) throw new GeocodeServiceError('geocoder_key_missing', 500);
    const ll = String(input.ll || '').trim(), spn = String(input.spn || '').trim(), key = this.cacheKey(address, ll, spn);
    const cached = this.cached(key); if (cached) return cached;
    const pending = this.inFlight.get(key); if (pending) return pending;
    this.enforceClientRate(String(input.clientKey || 'anonymous'));
    const request = this.providerRequest(address, String(input.apiKey).trim(), ll, spn, String(input.referer || '').trim()).then((response) => {
      const ttl = response.results.length ? this.successTtlMs : this.notFoundTtlMs;
      this.storeCache(key, { expiresAt: this.now() + ttl, response });
      return response;
    }).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, request);
    return request;
  }
}
