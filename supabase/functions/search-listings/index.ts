import { LISTING_FRESHNESS_DAYS, LISTING_FRESHNESS_MS, listingFreshnessDecision } from '../_shared/listings/freshness.ts';
import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';
import { isListingSelected, LISTING_SELECTION } from '../_shared/listings/selection.ts';
import type { ListingPremiseType, ListingSource, NormalizedListing } from '../_shared/listings/types.ts';
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

export interface ListingReadCursor {
  firstSeenAt: string;
  source: ListingSource;
  listingUrl: string;
}

export interface ListingReadRequest {
  sources: ListingSource[];
  page: number;
  limit: number;
  snapshotAt: string | null;
  cursor: ListingReadCursor | null;
  areaMin: number | null;
  areaMax: number | null;
  floor: number | null;
  premiseTypes: ListingPremiseType[];
}

export interface ListingReadPage {
  items: NormalizedListing[];
  total: number;
  hasMore: boolean;
  nextCursor: ListingReadCursor | null;
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

const allowedPremiseTypes = new Set<ListingPremiseType>(LISTING_SELECTION.premiseTypes);

function premiseTypes(value: unknown): ListingPremiseType[] | null {
  const raw = value == null ? [...LISTING_SELECTION.premiseTypes] : value;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const unique = [...new Set(raw.map((entry) => String(entry) as ListingPremiseType))];
  return unique.every((entry) => allowedPremiseTypes.has(entry)) ? unique : null;
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function readCursor(value: unknown, sources: ListingSource[]): ListingReadCursor | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('cursor must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['firstSeenAt', 'source', 'listingUrl'].includes(key))) throw new Error('cursor contains unsupported fields');
  const firstSeenAt = String(record.firstSeenAt || '');
  const source = String(record.source || '') as ListingSource;
  const listingUrl = String(record.listingUrl || '');
  if (!Number.isFinite(new Date(firstSeenAt).getTime())) throw new Error('cursor firstSeenAt must be an ISO date');
  if (!sources.includes(source)) throw new Error('cursor source must be requested');
  try {
    const parsed = new URL(listingUrl);
    if (parsed.protocol !== 'https:' || !/(^|\.)cian\.ru$/i.test(parsed.hostname)) throw new Error();
  } catch { throw new Error('cursor listingUrl must be a Cian HTTPS URL'); }
  return { firstSeenAt: new Date(firstSeenAt).toISOString(), source, listingUrl };
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
  let cursor: ListingReadCursor | null;
  try { cursor = readCursor(body.cursor, sources); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'cursor is invalid' }; }
  if (cursor && snapshotAt == null) return { ok: false, error: 'snapshotAt is required with cursor' };
  if (page > 1 && !cursor) return { ok: false, error: 'cursor is required after the first page' };
  if (page === 1 && cursor) return { ok: false, error: 'cursor is not allowed on the first page' };
  const requestedAreaMin = numeric(body.areaMin);
  const requestedAreaMax = numeric(body.areaMax);
  const requestedFloor = numeric(body.floor);
  if (body.areaMin != null && requestedAreaMin !== LISTING_SELECTION.areaMin) return { ok: false, error: 'areaMin is fixed at 100' };
  if (body.areaMax != null && requestedAreaMax !== LISTING_SELECTION.areaMax) return { ok: false, error: 'areaMax is fixed at 150' };
  if (body.floor != null && requestedFloor !== LISTING_SELECTION.floor) return { ok: false, error: 'floor is fixed at 1' };
  const requestedPremiseTypes = premiseTypes(body.premiseTypes);
  if (!requestedPremiseTypes) return { ok: false, error: 'premiseTypes accepts office, retail and free_purpose' };
  return { ok: true, request: {
    sources, page, limit, snapshotAt, cursor,
    areaMin: LISTING_SELECTION.areaMin,
    areaMax: LISTING_SELECTION.areaMax,
    floor: LISTING_SELECTION.floor,
    premiseTypes: requestedPremiseTypes,
  } };
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
    premiseType: allowedPremiseTypes.has(row.premise_type as ListingPremiseType) ? row.premise_type as ListingPremiseType : null,
    hasBasementOrSocle: row.has_basement_or_socle === true,
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
      `first_seen_at=lte.${encodeURIComponent(snapshot.toISOString())}`,
      'freshness_kind=in.(published,updated)',
      'market_status=neq.removed', 'order=first_seen_at.desc,source.asc,listing_url.asc', `limit=${request.limit + 1}`,
    ];
    if (request.sources.length === 1) parts.push(`source=eq.${request.sources[0]}`);
    else parts.push(`source=in.(${request.sources.join(',')})`);
    if (request.areaMin != null) parts.push(`area=gte.${request.areaMin}`);
    if (request.areaMax != null) parts.push(`area=lte.${request.areaMax}`);
    if (request.floor != null) parts.push(`floor=eq.${request.floor}`);
    parts.push(`premise_type=in.(${request.premiseTypes.join(',')})`);
    parts.push('has_basement_or_socle=eq.false');
    if (request.cursor) {
      const at = encodeURIComponent(request.cursor.firstSeenAt);
      const source = encodeURIComponent(request.cursor.source);
      const url = encodeURIComponent(request.cursor.listingUrl);
      parts.push(`or=(first_seen_at.lt.${at},and(first_seen_at.eq.${at},source.gt.${source}),and(first_seen_at.eq.${at},source.eq.${source},listing_url.gt.${url}))`);
    }
    const result = await this.#readPage(`slogi_market_listings?${parts.join('&')}`);
    const rows = result.rows.slice(0, request.limit) as Array<Record<string, unknown>>;
    const last = rows.at(-1);
    const nextCursor = result.rows.length > request.limit && last ? {
      firstSeenAt: String(last.first_seen_at || ''),
      source: last.source as ListingSource,
      listingUrl: String(last.listing_url || ''),
    } : null;
    if (nextCursor && (!Number.isFinite(new Date(nextCursor.firstSeenAt).getTime()) || !nextCursor.listingUrl)) throw new Error('market_read_cursor_invalid');
    return {
      items: rows.map((row) => rowToListing(row)), total: result.total,
      hasMore: nextCursor != null, nextCursor,
    };
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
    if (parsed.request.cursor && new Date(parsed.request.cursor.firstSeenAt).getTime() > snapshot.getTime()) {
      return response({ status: 'invalid_request', error: 'cursor is after snapshotAt' }, 400);
    }
    const readRequest = { ...parsed.request, snapshotAt: snapshot.toISOString() };
    let store = dependencies.store;
    if (!store) {
      try { store = new SupabaseListingReadStore(dependencies.environment || runtimeEnvironment(), dependencies.fetch || fetch); }
      catch { return response({ status: 'provider_error', error: 'market_read_not_configured' }, 503); }
    }
    try {
      const [storedPage, states] = await Promise.all([store.readRecent(readRequest, now), store.readScanStates(parsed.request.sources)]);
      const requestedPremiseTypes = new Set(parsed.request.premiseTypes);
      const items = storedPage.items
        .filter((item) => item.marketStatus !== 'removed'
          && listingFreshnessDecision(item, snapshot) === 'recent'
          && isListingSelected(item)
          && item.premiseType != null
          && requestedPremiseTypes.has(item.premiseType))
        .sort((left, right) => {
          const firstSeen = new Date(right.firstSeenAt).getTime() - new Date(left.firstSeenAt).getTime();
          return firstSeen || left.source.localeCompare(right.source) || left.listingUrl.localeCompare(right.listingUrl);
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
      const hasMore = storedPage.hasMore === true;
      const meta = {
        sources: sourceMeta, page: parsed.request.page, limit: parsed.request.limit, fetchedAt: now.toISOString(),
        total: storedPage.total, returned: items.length, hasMore,
        nextPage: hasMore ? parsed.request.page + 1 : null,
        nextCursor: hasMore ? storedPage.nextCursor : null,
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
