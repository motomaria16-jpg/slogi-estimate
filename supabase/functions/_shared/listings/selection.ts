import type { ListingPremiseType, NormalizedListing } from './types.ts';

export const LISTING_SELECTION = Object.freeze({
  areaMin: 100,
  areaMax: 150,
  floor: 1,
  premiseTypes: Object.freeze(['office', 'retail', 'free_purpose'] as const),
});

export type ListingSelectionRejection =
  | 'selection_missing_area'
  | 'selection_area_out_of_range'
  | 'selection_basement_or_socle'
  | 'selection_floor_not_first'
  | 'selection_missing_premise_type'
  | 'selection_premise_type_not_allowed';

const allowedPremiseTypes = new Set<ListingPremiseType>(LISTING_SELECTION.premiseTypes);

export function listingSelectionRejection(listing: Pick<NormalizedListing, 'area' | 'floor' | 'premiseType' | 'hasBasementOrSocle'>): ListingSelectionRejection | null {
  if (listing.area == null) return 'selection_missing_area';
  if (listing.area < LISTING_SELECTION.areaMin || listing.area > LISTING_SELECTION.areaMax) return 'selection_area_out_of_range';
  if (listing.hasBasementOrSocle) return 'selection_basement_or_socle';
  if (listing.floor !== LISTING_SELECTION.floor) return 'selection_floor_not_first';
  if (listing.premiseType == null) return 'selection_missing_premise_type';
  if (!allowedPremiseTypes.has(listing.premiseType)) return 'selection_premise_type_not_allowed';
  return null;
}

export function isListingSelected(listing: Pick<NormalizedListing, 'area' | 'floor' | 'premiseType' | 'hasBasementOrSocle'>): boolean {
  return listingSelectionRejection(listing) == null;
}
