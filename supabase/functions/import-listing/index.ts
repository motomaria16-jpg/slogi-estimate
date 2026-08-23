import {
  BrowserlessClient,
  resolveBrowserlessTimeoutProfile,
  safeBrowserlessError,
  type BrowserlessPageClient,
} from '../_shared/listings/browserless.ts';
import { isCompleteListing, uniqueWarnings } from '../_shared/listings/parsing.ts';
import { providerForUrl } from '../_shared/listings/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-slogi-client',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

interface ImportListingDependencies {
  client?: BrowserlessPageClient;
  now?: () => Date;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function publicError(status: 'invalid_url' | 'blocked' | 'provider_error'): string {
  if (status === 'invalid_url') return 'Поддерживаются только публичные ссылки на объявления ЦИАН.';
  if (status === 'blocked') return 'Площадка ограничила доступ к публичной странице объявления.';
  return 'Сервис получения страницы объявления временно недоступен.';
}

export function createImportListingHandler(dependencies: ImportListingDependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return response({ status: 'provider_error', error: 'Method not allowed' }, 405);

    const started = Date.now();
    try {
      const body = await request.json().catch(() => ({}));
      const rawUrl = String(body?.url || '').trim();
      const provider = providerForUrl(rawUrl);
      if (!provider || (body?.provider && body.provider !== 'cian')) {
        return response({ status: 'invalid_url', error: publicError('invalid_url'), data: null }, 400);
      }
      const validated = provider.validateAndCanonicalizeUrl(rawUrl);
      if (!validated.ok || !validated.canonicalUrl) {
        return response({ status: 'invalid_url', error: publicError('invalid_url'), data: null }, 400);
      }

      let client = dependencies.client;
      if (!client) {
        try {
          client = BrowserlessClient.fromEnvironment();
        } catch (error) {
          return response({
            status: 'provider_error',
            error: publicError('provider_error'),
            data: null,
            meta: { code: safeBrowserlessError(error), durationMs: Date.now() - started, warnings: [] },
          }, 503);
        }
      }

      const page = await client.fetchPage(validated.canonicalUrl, {
        includeLinks: false,
        allowUnblock: false,
        directUnblock: false,
        strategies: ['smart-scrape'],
        retryCount: 0,
        ...resolveBrowserlessTimeoutProfile('cian', 'card', 'smart-scrape'),
      });
      const safeMeta = {
        strategy: page.strategy,
        attempted: page.attempted,
        durationMs: Date.now() - started,
        warnings: uniqueWarnings(page.warnings),
        errors: [] as string[],
      };
      if (page.status === 'blocked') {
        return response({
          status: 'blocked',
          error: publicError('blocked'),
          data: null,
          meta: { ...safeMeta, blockReason: page.blockReason || 'blocked' },
        }, 502);
      }
      if (page.status === 'error') {
        return response({
          status: 'provider_error',
          error: publicError('provider_error'),
          data: null,
          meta: { ...safeMeta, code: page.errorCode || 'provider_error' },
        }, 502);
      }

      const observedAt = (dependencies.now?.() || new Date()).toISOString();
      const listing = provider.parseListing(page, validated.canonicalUrl, observedAt);
      const status = isCompleteListing(listing) ? 'success' : 'partial';
      return response({
        status,
        data: listing,
        meta: {
          ...safeMeta,
          status,
          warnings: uniqueWarnings([...safeMeta.warnings, ...listing.parseWarnings]),
          parseCompleteness: listing.parseCompleteness,
        },
      });
    } catch {
      return response({ status: 'provider_error', error: publicError('provider_error'), data: null }, 500);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createImportListingHandler());
}
