import { validateSupabaseServiceUrl } from './supabase-url.ts';
import type { EnvironmentReader } from './browserless.ts';
import type { ListingSource, NormalizedListing } from './types.ts';

export type ScanPhase = 'discovery' | 'hydration';
export type QueuePriority = 'hot' | 'backfill';
export type QueueStatus =
  | 'pending' | 'processing' | 'retry' | 'completed'
  | 'discarded_old' | 'discarded_unknown_date' | 'blocked' | 'failed';

export interface ScanState {
  source: ListingSource;
  nextPage: number;
  discoveryFailures: number;
  hydrationFailures: number;
  lastDiscoveryStartedAt: string | null;
  lastDiscoverySucceededAt: string | null;
  lastDiscoveryErrorCode: string | null;
  lastHydrationStartedAt: string | null;
  lastHydrationSucceededAt: string | null;
  lastHydrationErrorCode: string | null;
  cooldownUntil: string | null;
}

export interface RunClaim {
  claimed: boolean;
  runId: number | null;
  recovered: boolean;
}

export interface QueueInput {
  listingUrl: string;
  externalId: string | null;
}

export interface QueueEnqueueResult {
  listingUrl: string;
  queueStatus: QueueStatus;
  queuedNew: boolean;
}

export interface QueueItem extends QueueInput {
  id: number;
  source: ListingSource;
  priority: QueuePriority;
  status: QueueStatus;
  attemptCount: number;
  discoveredAt: string;
  lastDiscoveredAt: string;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastAttemptAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
}

export interface QueueFinish {
  status: Exclude<QueueStatus, 'pending' | 'processing'>;
  finishedAt: string;
  nextAttemptAt: string | null;
  errorCode: string | null;
  diagnostic: Record<string, unknown>;
}

export interface RunFinish {
  status: 'ok' | 'partial' | 'blocked' | 'failed' | 'cooldown' | 'timed_out' | 'empty';
  finishedAt: string;
  metrics: Record<string, number>;
  strategy: string | null;
  errorCode: string | null;
  diagnostic: Record<string, unknown>;
}

export interface PersistResult { inserted: number; updated: number }

export interface ListingServerStore {
  getState(source: ListingSource, signal?: AbortSignal): Promise<ScanState>;
  saveState(state: ScanState, updatedAt: string, signal?: AbortSignal): Promise<void>;
  claimRun(source: ListingSource, phase: ScanPhase, runSlot: string, startedAt: string, staleBefore: string, signal?: AbortSignal): Promise<RunClaim>;
  finishRun(runId: number, update: RunFinish, signal?: AbortSignal): Promise<void>;
  enqueue(source: ListingSource, priority: QueuePriority, items: QueueInput[], discoveredAt: string, signal?: AbortSignal): Promise<QueueEnqueueResult[]>;
  claimQueue(source: ListingSource, workerId: string, limit: number, claimedAt: string, staleBefore: string, signal?: AbortSignal): Promise<QueueItem[]>;
  finishQueue(id: number, workerId: string, update: QueueFinish, signal?: AbortSignal): Promise<boolean>;
  persistRecent(source: ListingSource, listings: NormalizedListing[], observedAt: string, signal?: AbortSignal): Promise<PersistResult>;
  markRemoved(source: ListingSource, listingUrl: string, observedAt: string, signal?: AbortSignal): Promise<void>;
}

interface RestResult { status: number; data: unknown }

function integer(value: unknown, fallback = 0): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

function reliable<T>(incoming: T | null | undefined, existing: unknown): T | unknown | null {
  if (incoming == null) return existing ?? null;
  if (typeof incoming === 'string' && incoming.trim() === '') return existing ?? null;
  return incoming;
}

function stateFromRow(row: Record<string, unknown>, source: ListingSource): ScanState {
  return {
    source,
    nextPage: Math.max(2, integer(row.next_page, 2)),
    discoveryFailures: Math.max(0, integer(row.discovery_failures)),
    hydrationFailures: Math.max(0, integer(row.hydration_failures)),
    lastDiscoveryStartedAt: nullable(row.last_discovery_started_at),
    lastDiscoverySucceededAt: nullable(row.last_discovery_succeeded_at),
    lastDiscoveryErrorCode: nullable(row.last_discovery_error_code),
    lastHydrationStartedAt: nullable(row.last_hydration_started_at),
    lastHydrationSucceededAt: nullable(row.last_hydration_succeeded_at),
    lastHydrationErrorCode: nullable(row.last_hydration_error_code),
    cooldownUntil: nullable(row.cooldown_until),
  };
}

function queueFromRow(row: Record<string, unknown>): QueueItem {
  return {
    id: integer(row.id),
    source: row.source as ListingSource,
    listingUrl: String(row.listing_url || ''),
    externalId: nullable(row.external_id),
    priority: row.priority as QueuePriority,
    status: row.status as QueueStatus,
    attemptCount: Math.max(0, integer(row.attempt_count)),
    discoveredAt: String(row.discovered_at || ''),
    lastDiscoveredAt: String(row.last_discovered_at || ''),
    nextAttemptAt: String(row.next_attempt_at || ''),
    lockedAt: nullable(row.locked_at),
    lockedBy: nullable(row.locked_by),
    lastAttemptAt: nullable(row.last_attempt_at),
    completedAt: nullable(row.completed_at),
    lastErrorCode: nullable(row.last_error_code),
  };
}

export class SupabaseListingServerStore implements ListingServerStore {
  #baseUrl: string;
  #serviceKey: string;
  #fetch: typeof fetch;

  constructor(environment: EnvironmentReader, fetchImpl: typeof fetch = fetch) {
    const baseUrl = String(environment.get('SUPABASE_URL') || '').trim();
    const serviceKey = String(environment.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    if (!baseUrl || !serviceKey) throw new Error('listing_server_store_not_configured');
    this.#baseUrl = validateSupabaseServiceUrl(baseUrl);
    this.#serviceKey = serviceKey;
    this.#fetch = fetchImpl;
  }

  async #request(path: string, init: RequestInit = {}, accepted: number[] = [200, 201, 204], signal?: AbortSignal): Promise<RestResult> {
    const headers = new Headers(init.headers || {});
    headers.set('apikey', this.#serviceKey);
    headers.set('Authorization', `Bearer ${this.#serviceKey}`);
    headers.set('Content-Type', 'application/json');
    const result = await this.#fetch(`${this.#baseUrl}/rest/v1/${path}`, { ...init, headers, signal: signal || init.signal });
    const text = await result.text();
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!accepted.includes(result.status)) throw new Error(`listing_server_store_http_${result.status}`);
    return { status: result.status, data };
  }

  async getState(source: ListingSource, signal?: AbortSignal): Promise<ScanState> {
    const result = await this.#request(`slogi_listing_scan_state?source=eq.${source}&select=*&limit=1`, {}, [200], signal);
    const row = Array.isArray(result.data) ? result.data[0] as Record<string, unknown> | undefined : undefined;
    return stateFromRow(row || {}, source);
  }

  async saveState(state: ScanState, updatedAt: string, signal?: AbortSignal): Promise<void> {
    await this.#request('slogi_listing_scan_state?on_conflict=source', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        source: state.source,
        next_page: state.nextPage,
        discovery_failures: state.discoveryFailures,
        hydration_failures: state.hydrationFailures,
        last_discovery_started_at: state.lastDiscoveryStartedAt,
        last_discovery_succeeded_at: state.lastDiscoverySucceededAt,
        last_discovery_error_code: state.lastDiscoveryErrorCode,
        last_hydration_started_at: state.lastHydrationStartedAt,
        last_hydration_succeeded_at: state.lastHydrationSucceededAt,
        last_hydration_error_code: state.lastHydrationErrorCode,
        cooldown_until: state.cooldownUntil,
        updated_at: updatedAt,
      }),
    }, [200, 201, 204], signal);
  }

  async claimRun(source: ListingSource, phase: ScanPhase, runSlot: string, startedAt: string, staleBefore: string, signal?: AbortSignal): Promise<RunClaim> {
    const result = await this.#request('rpc/slogi_claim_listing_scan_run', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ p_source: source, p_phase: phase, p_run_slot: runSlot, p_started_at: startedAt, p_stale_before: staleBefore }),
    }, [200], signal);
    const row = Array.isArray(result.data) ? result.data[0] as Record<string, unknown> | undefined : undefined;
    const runId = row?.run_id == null ? null : Number(row.run_id);
    if (row?.claimed === true && !Number.isFinite(runId)) throw new Error('listing_run_claim_invalid');
    return { claimed: row?.claimed === true, runId, recovered: row?.recovered === true };
  }

  async finishRun(runId: number, update: RunFinish, signal?: AbortSignal): Promise<void> {
    const allowed = new Set([
      'discovered', 'queued_new', 'queued_existing', 'hot', 'backfill', 'claimed',
      'attempted', 'parsed', 'partial', 'blocked', 'failed', 'inserted', 'updated',
      'skipped_old', 'skipped_unknown_date',
    ]);
    const metrics = Object.fromEntries(Object.entries(update.metrics)
      .filter(([name]) => allowed.has(name))
      .map(([name, value]) => [name, Math.max(0, integer(value))]));
    await this.#request(`slogi_listing_scan_runs?id=eq.${runId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        finished_at: update.finishedAt,
        status: update.status,
        ...metrics,
        strategy: update.strategy,
        error_code: update.errorCode,
        diagnostic: update.diagnostic,
      }),
    }, [200, 204], signal);
  }

  async enqueue(source: ListingSource, priority: QueuePriority, items: QueueInput[], discoveredAt: string, signal?: AbortSignal): Promise<QueueEnqueueResult[]> {
    if (!items.length) return [];
    const result = await this.#request('rpc/slogi_enqueue_listing_fetches', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ p_source: source, p_priority: priority, p_items: items, p_discovered_at: discoveredAt }),
    }, [200], signal);
    if (!Array.isArray(result.data)) return [];
    return result.data.map((entry) => {
      const row = entry as Record<string, unknown>;
      return { listingUrl: String(row.listing_url || ''), queueStatus: row.queue_status as QueueStatus, queuedNew: row.queued_new === true };
    });
  }

  async claimQueue(source: ListingSource, workerId: string, limit: number, claimedAt: string, staleBefore: string, signal?: AbortSignal): Promise<QueueItem[]> {
    const result = await this.#request('rpc/slogi_claim_listing_fetch_queue', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ p_source: source, p_worker_id: workerId, p_batch_limit: limit, p_claimed_at: claimedAt, p_stale_before: staleBefore }),
    }, [200], signal);
    return Array.isArray(result.data) ? result.data.map((row) => queueFromRow(row as Record<string, unknown>)) : [];
  }

  async finishQueue(id: number, workerId: string, update: QueueFinish, signal?: AbortSignal): Promise<boolean> {
    const result = await this.#request('rpc/slogi_finish_listing_fetch_queue', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        p_id: id,
        p_worker_id: workerId,
        p_status: update.status,
        p_finished_at: update.finishedAt,
        p_next_attempt_at: update.nextAttemptAt,
        p_error_code: update.errorCode,
        p_diagnostic: update.diagnostic,
      }),
    }, [200], signal);
    return result.data === true;
  }

  async persistRecent(source: ListingSource, listings: NormalizedListing[], observedAt: string, signal?: AbortSignal): Promise<PersistResult> {
    if (!listings.length) return { inserted: 0, updated: 0 };
    const encoded = listings.map((item) => `"${item.listingUrl.replace(/"/g, '\\"')}"`).join(',');
    const existingResult = await this.#request(
      `slogi_market_listings?source=eq.${source}&listing_url=in.(${encodeURIComponent(encoded)})&select=*`,
      {}, [200], signal,
    );
    const existing = Array.isArray(existingResult.data) ? existingResult.data as Array<Record<string, unknown>> : [];
    const byUrl = new Map(existing.map((row) => [String(row.listing_url), row]));
    const history: Array<Record<string, unknown>> = [];
    const rows = listings.map((item) => {
      const previous = byUrl.get(item.listingUrl);
      const previousRent = previous?.rent_monthly == null ? null : Number(previous.rent_monthly);
      const changed = previousRent != null && item.rentMonthly != null && previousRent !== item.rentMonthly;
      const preserveMissing = (item.parseWarnings || []).includes('partial_listing');
      const merged = <T>(incoming: T | null | undefined, existing: unknown): T | unknown | null =>
        preserveMissing ? reliable(incoming, existing) : incoming == null || (typeof incoming === 'string' && incoming.trim() === '') ? null : incoming;
      const incomingCoordinates = item.latitude != null && item.longitude != null;
      if (item.rentMonthly != null && (!previous || changed)) {
        history.push({ source, listing_url: item.listingUrl, rent_monthly: item.rentMonthly, recorded_at: observedAt });
      }
      return {
        source, listing_url: item.listingUrl,
        external_id: merged(item.externalId, previous?.external_id),
        title: merged(item.title, previous?.title),
        address: merged(item.address, previous?.address),
        description: merged(item.description, previous?.description),
        cluster_name: merged(item.clusterName, previous?.cluster_name),
        area: merged(item.area, previous?.area),
        floor: merged(item.floor, previous?.floor),
        total_floors: merged(item.totalFloors, previous?.total_floors),
        ceiling_height: merged(item.ceilingHeight, previous?.ceiling_height),
        rent_monthly: merged(item.rentMonthly, previous?.rent_monthly),
        previous_rent_monthly: changed ? previousRent : preserveMissing ? reliable(item.previousRentMonthly, previous?.previous_rent_monthly) : null,
        latitude: incomingCoordinates || !preserveMissing ? item.latitude : previous?.latitude ?? null,
        longitude: incomingCoordinates || !preserveMissing ? item.longitude : previous?.longitude ?? null,
        first_seen_at: String(previous?.first_seen_at || item.firstSeenAt || observedAt), last_seen_at: observedAt,
        last_checked_at: observedAt, market_status: previous ? 'active' : 'new',
        price_changed: preserveMissing ? changed || previous?.price_changed === true : changed, missed_scans: 0,
        published_at: merged(item.publishedAt, previous?.published_at),
        source_updated_at: merged(item.sourceUpdatedAt, previous?.source_updated_at),
        freshness_at: merged(item.freshnessAt, previous?.freshness_at),
        freshness_kind: merged(item.freshnessKind, previous?.freshness_kind),
        date_confidence: merged(item.dateConfidence, previous?.date_confidence),
        parse_completeness: item.parseCompleteness,
        parse_warnings: [...new Set([...(item.parseWarnings || []), ...(item.dateWarnings || [])])], updated_at: observedAt,
      };
    });
    await this.#request('slogi_market_listings?on_conflict=source,listing_url', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    }, [200, 201, 204], signal);
    if (history.length) {
      await this.#request('slogi_market_price_history', {
        method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(history),
      }, [200, 201, 204], signal);
    }
    return { inserted: listings.length - existing.length, updated: existing.length };
  }

  async markRemoved(source: ListingSource, listingUrl: string, observedAt: string, signal?: AbortSignal): Promise<void> {
    const encoded = encodeURIComponent(listingUrl);
    await this.#request(`slogi_market_listings?source=eq.${source}&listing_url=eq.${encoded}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ market_status: 'removed', last_checked_at: observedAt, updated_at: observedAt }),
    }, [200, 204], signal);
  }
}
