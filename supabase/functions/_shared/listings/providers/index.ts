import type { ListingProvider, ListingSource } from '../types.ts';
import { CianListingProvider } from './cian.ts';

const CIAN_PROVIDER: ListingProvider = new CianListingProvider();

export { CianListingProvider };

export function providerBySource(source: ListingSource): ListingProvider {
  if (source !== 'cian') throw new Error('listing_source_disabled');
  return CIAN_PROVIDER;
}

export function providerForUrl(rawUrl: string): ListingProvider | null {
  return CIAN_PROVIDER.validateAndCanonicalizeUrl(rawUrl).ok ? CIAN_PROVIDER : null;
}

export function allProviders(): ListingProvider[] {
  return [CIAN_PROVIDER];
}
