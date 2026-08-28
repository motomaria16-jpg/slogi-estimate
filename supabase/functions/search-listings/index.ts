import { LISTING_FRESHNESS_DAYS, LISTING_FRESHNESS_MS, listingFreshnessDecision } from '../_shared/listings/freshness.ts';
import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';
import type { ListingSource, NormalizedListing } from '../_shared/listings/types.ts';
import { authorizeDeviceGrant } from '../_shared/password-gate.ts';

interface EnvironmentReader {
  get(name: string): string | undefined;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client, x-slogi-device-grant',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

export const READ_LIMITS = Object.freeze({ maxItems: 100 });

export interface ListingReadRequest {
  sources: ListingSource[];
  page: number;
  limit: number;
  snapshotAt: string | null;
  areaMin: number | null;
  areaMax: number | null;
  floor: number | null;
}

export interface ListingReadPage {
  items: NormalizedListing[];
  total: number;
}

export interface ListingScanStateView {
  source: ListingSource;
  lastSucceededAt: string | null;
  lastDiscoveryAt?: string | null;
  lastHydrationAt?: string | null;
  cooldownUntil: string | null;
  errorCode: string | null;
}

export interface ListingReadStore {
  readRecent(request: ListingReadRequest, now: Date): Promise<ListingReadPage>;
  readScanStates(sources: ListingSource[]): Promise<ListingScanStateView[]>;
}

interface SearchHandlerDependencies {
  store?: ListingReadStore;
  environment?: EnvironmentReader;
  fetch?: typeof fetch;
  authorize?: (request: Request) => Promise<boolean>;
  now?: () => Date;
}

function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function numeric(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function parseSearchRequest(body: Record<string, unknown>): { ok: true; request: ListingReadRequest } | { ok: false; error: string } {
  if (body.persist != null || body.action != null || body.updateClusters != null) return { ok: false, error: 'search-listings is read-only' };
  const allowed = new Set<ListingSource>(['cian']);
  const rawSources = body.sources == null ? ['cian'] : body.sources;
  if (!Array.isArray(rawSources) || rawSources.length === 0 || rawSources.some((source) => !allowed.has(source as ListingSource))) {
    return { ok: false, error: 'sources accepts only cian' };
  }
  const sources = [...new Set(rawSources as ListingSource[])];
  const page = integerInRange(body.page, 1, 1, 1_000_000);
  const limit = integerInRange(body.limit ?? body.limitPerSource, 50, 1, READ_LIMITS.maxItems);
  const snapshotAt = body.snapshotAt == null ? null : String(body.snapshotAt);
  if (snapshotAt != null && !Number.isFinite(new Date(snapshotAt).getTime())) return { ok: false, error: 'snapshotAt must be an ISO date' };
  const areaMin = numeric(body.areaMin);
  const areaMax = numeric(body.areaMax);
  const floor = numeric(body.floor);
  if (areaMin != null && areaMax != null && areaMin > areaMax) return { ok: false, error: 'areaMin must be less than or equal to areaMax' };
  return { ok: true, request: { sources, page, limit, snapshotAt, areaMin, areaMax, floor } };
}

function safeCode(value: unknown): string | null {
  const code = String(value || '').trim();
  return /^[a-z0-9_:-]{1,80}$/i.test(code) ? code : null;
}

function rowToListing(row: Record<string, unknown>): NormalizedListing {
  const firstSeenAt = String(row.first_seen_at || new Date(0).toISOString());
  const lastSeenAt = String(row.last_seen_at || firstSeenAt);
  const parseWarnings = Array.isArray(row.parse_warnings) ? row.parse_warnings.map(String).slice(0, 30) : [];
  const freshnessKind = row.freshness_kind === 'published' || row.freshness_kind === 'updated' ? row.freshness_kind : null;
  return {
    source: row.source as ListingSource,
    listingUrl: String(row.listing_url || ''),
    externalId: row.external_id ? String(row.external_id) : null,
    title: row.title ? String(row.title) : null,
    address: String(row.address || ''),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    area: row.area == null ? null : Number(row.area),
    rentMonthly: row.rent_monthly == null ? null : Number(row.rent_monthly),
    pricePerSquareMeter: row.area && row.rent_monthly ? Math.round((Number(row.rent_monthly) / Number(row.area)) * 100) / 100 : null,
    floor: row.floor == null ? null : Number(row.floor),
    totalFloors: row.total_floors == null ? null : Number(row.total_floors),
    ceilingHeight: row.ceiling_height == null ? null : Number(row.ceiling_height),
    description: row.description ? String(row.description) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : null,
    freshnessAt: row.freshness_at ? String(row.freshness_at) : null,
    freshnessKind,
    dateConfidence: row.date_confidence ? String(row.date_confidence) : null,
    dateWarnings: parseWarnings.filter((warning) => /date|freshness|future/i.test(warning)),
    firstSeenAt,
    lastSeenAt,
    marketStatus: row.market_status === 'removed' ? 'removed' : row.market_status === 'new' ? 'new' : 'active',
    parseCompleteness: Number(row.parse_completeness) || 0,
    parseWarnings,
    windowsCount: null,
    previousRentMonthly: row.previous_rent_monthly == null ? null : Number(row.previous_rent_monthly),
    priceChanged: Boolean(row.price_changed),
    clusterName: String(row.cluster_name || ''),
  };
}

export class SupabaseListingReadStore implements ListingReadStore {
  #baseUrl: string;
  #serviceKey: string;
  #fetch: typeof fetch;

  constructor(environment: EnvironmentReader, fetchImpl: typeof fetch = fetch) {
    const baseUrl = String(environment.get('SUPABASE_URL') || '').trim();
    const serviceKey = String(environment.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    if (!baseUrl || !serviceKey) throw new Error('market_read_not_configured');
    this.#baseUrl = validateSupabaseServiceUrl(baseUrl);
    this.#serviceKey = serviceKey;
    this.#fetch = fetchImpl;
  }

  async #read(path: string): Promise<unknown> {
    const result = await this.#fetch(`${this.#baseUrl}/rest/v1/${path}`, {
      headers: { apikey: this.#serviceKey, Authorization: `Bearer ${this.#serviceKey}`, Accept: 'application/json' },
    });
    const text = await result.text();
    if (!result.ok) throw new Error(`market_read_http_${result.status}`);
    if (!text) return [];
    try { return JSON.parse(text); } catch { throw new Error('market_read_invalid_json'); }
  }

  async #readPage(path: string): Promise<{ rows: unknown[]; total: number }> {
    const result = await this.#fetch(`${this.#baseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: this.#serviceKey,
        Authorization: `Bearer ${this.#serviceKey}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
      },
    });
    const text = await result.text();
    if (!result.ok) throw new Error(`market_read_http_${result.status}`);
    let rows: unknown[];
    try { rows = text ? JSON.parse(text) : []; } catch { throw new Error('market_read_invalid_json'); }
    if (!Array.isArray(rows)) throw new Error('market_read_invalid_shape');
    const totalText = result.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
    const total = Number(totalText);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('market_read_count_missing');
    return { rows, total };
  }

  async readRecent(request: ListingReadRequest, now: Date): Promise<ListingReadPage> {
    const snapshot = request.snapshotAt ? new Date(request.snapshotAt) : now;
    const cutoff = new Date(snapshot.getTime() - LISTING_FRESHNESS_MS).toISOString();
    const parts = [
      'select=*', `freshness_at=gte.${encodeURIComponent(cutoff)}`, 'freshness_at=not.is.null',
      `freshness_at=lte.${encodeURIComponent(snapshot.toISOString())}`,
      `updated_at=lte.${encodeURIComponent(snapshot.toISOString())}`,
      'market_status=neq.removed', 'order=freshness_at.desc,source.asc,external_id.asc.nullslast,listing_url.asc', `limit=${request.limit}`,
      `offset=${(request.page - 1) * request.limit}`,
    ];
    if (request.sources.length === 1) parts.push(`source=eq.${request.sources[0]}`);
    else parts.push(`source=in.(${request.sources.join(',')})`);
    if (request.areaMin != null) parts.push(`area=gte.${request.areaMin}`);
    if (request.areaMax != null) parts.push(`area=lte.${request.areaMax}`);
    if (request.floor != null) parts.push(`floor=eq.${request.floor}`);
    const result = await this.#readPage(`slogi_market_listings?${parts.join('&')}`);
    return { items: result.rows.map((row) => rowToListing(row as Record<string, unknown>)), total: result.total };
  }

  async readScanStates(sources: ListingSource[]): Promise<ListingScanStateView[]> {
    const rows = await this.#read(`slogi_listing_scan_state?source=in.(${sources.join(',')})&select=source,last_discovery_succeeded_at,last_hydration_succeeded_at,cooldown_until,last_discovery_error_code,last_hydration_error_code`);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      const lastDiscoveryAt = value.last_discovery_succeeded_at ? String(value.last_discovery_succeeded_at) : null;
      const lastHydrationAt = value.last_hydration_succeeded_at ? String(value.last_hydration_succeeded_at) : null;
      return {
        source: value.source as ListingSource,
        lastSucceededAt: lastHydrationAt || lastDiscoveryAt,
        lastDiscoveryAt,
        lastHydrationAt,
        cooldownUntil: value.cooldown_until ? String(value.cooldown_until) : null,
        errorCode: safeCode(value.last_hydration_error_code) || safeCode(value.last_discovery_error_code),
      };
    }).filter((row) => sources.includes(row.source));
  }
}

function hasBearerSession(request: Request): boolean {
  return /^Bearer\s+[^\s]+$/i.test(request.headers.get('Authorization') || '');
}

export function createSearchListingsHandler(dependencies: SearchHandlerDependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'invalid_request', error: 'Method not allowed' }, 405);
    if (!hasBearerSession(request)) return response({ status: 'unauthorized', error: 'Unauthorized' }, 401);
    const authorized = dependencies.authorize
      ? await dependencies.authorize(request).catch(() => false)
      : (await authorizeDeviceGrant(
        request,
        dependencies.environment || runtimeEnvironment(),
        dependencies.fetch || fetch,
      )).ok;
    if (!authorized) return response({ status: 'unauthorized', error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const parsed = parseSearchRequest(body);
    if (!parsed.ok) return response({ status: 'invalid_request', error: parsed.error }, 400);
    const now = dependencies.now?.() || new Date();
    const snapshot = parsed.request.snapshotAt ? new Date(parsed.request.snapshotAt) : now;
    if (snapshot.getTime() > now.getTime() + 5 * 60_000) return response({ status: 'invalid_request', error: 'snapshotAt is in the future' }, 400);
    const readRequest = { ...parsed.request, snapshotAt: snapshot.toISOString() };
    let store = dependencies.store;
    if (!store) {
      try { store = new SupabaseListingReadStore(dependencies.environment || runtimeEnvironment(), dependencies.fetch || fetch); }
      catch { return response({ status: 'provider_error', error: 'market_read_not_configured' }, 503); }
    }
    try {
      const [storedPage, states] = await Promise.all([store.readRecent(readRequest, now), store.readScanStates(parsed.request.sources)]);
      const items = storedPage.items
        .filter((item) => item.marketStatus !== 'removed' && listingFreshnessDecision(item, snapshot) === 'recent')
        .sort((left, right) => {
          const freshness = new Date(right.freshnessAt || 0).getTime() - new Date(left.freshnessAt || 0).getTime();
          if (freshness) return freshness;
          const leftKey = `${left.source}:${left.externalId || left.listingUrl}`;
          const rightKey = `${right.source}:${right.externalId || right.listingUrl}`;
          return leftKey.localeCompare(rightKey);
        });
      const stateBySource = new Map(states.map((state) => [state.source, state]));
      const sourceMeta = Object.fromEntries(parsed.request.sources.map((source) => {
        const state = stateBySource.get(source);
        const cooldownActive = Boolean(state?.cooldownUntil && new Date(state.cooldownUntil).getTime() > now.getTime());
        return [source, {
          status: cooldownActive ? 'cooldown' : state?.lastSucceededAt ? 'ok' : state?.errorCode ? 'error' : 'never_scanned',
          returned: items.filter((item) => item.source === source).length,
          lastSucceededAt: state?.lastSucceededAt || null,
          lastDiscoveryAt: state?.lastDiscoveryAt || null,
          lastHydrationAt: state?.lastHydrationAt || null,
          cooldownUntil: cooldownActive ? state?.cooldownUntil : null,
          sourceCooldown: cooldownActive,
          errorCode: state?.errorCode || null,
        }];
      }));
      const offset = (parsed.request.page - 1) * parsed.request.limit;
      const hasMore = offset + items.length < storedPage.total;
      const meta = {
        sources: sourceMeta, page: parsed.request.page, limit: parsed.request.limit, fetchedAt: now.toISOString(),
        total: storedPage.total, returned: items.length, hasMore,
        nextPage: hasMore ? parsed.request.page + 1 : null,
        snapshotAt: snapshot.toISOString(),
        freshnessCutoff: new Date(snapshot.getTime() - LISTING_FRESHNESS_MS).toISOString(),
        freshnessDays: LISTING_FRESHNESS_DAYS, persistence: 'disabled',
      };
      return response({ items, data: items, meta });
    } catch {
      return response({ status: 'provider_error', error: 'market_read_failed' }, 503);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createSearchListingsHandler());
}
