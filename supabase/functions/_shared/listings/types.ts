export type ListingSource = 'cian' | 'avito';
export type ListingPremiseType = 'office' | 'retail' | 'free_purpose';

export type BrowserlessStrategy = 'smart-scrape' | 'content' | 'unblock';
export type BrowserlessPageStatus = 'ok' | 'blocked' | 'error';
export type ListingMarketStatus = 'new' | 'active' | 'removed';

export interface BrowserlessAttemptSummary {
  strategy: BrowserlessStrategy;
  ordinalAttempt: number;
  errorCode: string | null;
  statusCode: number | null;
  durationMs: number;
  retryable: boolean;
}

export interface BrowserlessFailureFingerprint {
  statusCode: number;
  bodyByteLength: number;
  bodySha256: string;
}

export interface BrowserlessPage {
  status: BrowserlessPageStatus;
  html: string;
  markdown: string;
  links: string[];
  strategy: BrowserlessStrategy | null;
  attempted: BrowserlessStrategy[];
  statusCode: number | null;
  durationMs: number;
  blockReason: string | null;
  warnings: string[];
  errorCode?: string;
  attemptSummaries?: BrowserlessAttemptSummary[];
  failureFingerprint?: BrowserlessFailureFingerprint | null;
}

export interface NormalizedListing {
  source: ListingSource;
  listingUrl: string;
  externalId: string | null;
  title: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  area: number | null;
  rentMonthly: number | null;
  pricePerSquareMeter: number | null;
  floor: number | null;
  premiseType: ListingPremiseType | null;
  hasBasementOrSocle: boolean;
  totalFloors: number | null;
  ceilingHeight: number | null;
  description: string | null;
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  freshnessAt: string | null;
  freshnessKind: 'published' | 'updated' | null;
  dateConfidence: string | null;
  dateWarnings: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  marketStatus: ListingMarketStatus;
  parseCompleteness: number;
  parseWarnings: string[];

  // Existing SLOGI client/market fields remain available.
  windowsCount?: number | null;
  previousRentMonthly?: number | null;
  priceChanged?: boolean;
  clusterName?: string;
}

export interface ListingUrlResult {
  ok: boolean;
  source: ListingSource;
  canonicalUrl: string | null;
  externalId: string | null;
  reason?: string;
}

export interface ListingSearchFilters {
  areaMin: number | null;
  areaMax: number | null;
  floor: number | null;
  searchBaseUrl?: string;
}

export interface ListingProviderDiagnostics {
  source: ListingSource;
  strategy: BrowserlessStrategy | null;
  completeness: number;
  warnings: string[];
}

export interface ListingProvider {
  readonly source: ListingSource;
  validateAndCanonicalizeUrl(rawUrl: string): ListingUrlResult;
  buildSearchUrl(page: number, filters: ListingSearchFilters): string;
  discoverListingUrls(page: BrowserlessPage): string[];
  deduplicate(urls: string[]): string[];
  parseListing(page: BrowserlessPage, canonicalUrl: string, observedAt?: string): NormalizedListing;
  normalizeResult(candidate: Partial<NormalizedListing>, canonicalUrl: string, observedAt?: string): NormalizedListing;
  diagnostics(listing: NormalizedListing, page: BrowserlessPage): ListingProviderDiagnostics;
}

export interface SourceSearchMeta {
  status: 'ok' | 'partial' | 'blocked' | 'failed' | 'empty';
  discovered: number;
  attempted: number;
  parsed: number;
  partial: number;
  blocked: number;
  failed: number;
  strategy: string;
  durationMs: number;
  warnings: string[];

  // Compatibility diagnostics consumed by available-spaces.js.
  returned: number;
  strategies: string[];
  errors: string[];
  diagnostic: Record<string, unknown>;
  quality: Record<string, unknown>;
  removedConfirmed: number;
}
