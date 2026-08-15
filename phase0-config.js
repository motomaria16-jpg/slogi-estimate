(function(){
'use strict';

const existing=window.SLOGI_PHASE0_CONFIG||{};
const existingListing=existing.listingImport||{};
const existingCompetitive=existing.competitiveAnalysis||{};
const existingGeocoding=existing.geocoding||{};
const existingListingSearch=existing.listingSearch||{};

window.SLOGI_PHASE0_CONFIG={
  listingImport:{
    endpoint:String(existingListing.endpoint||'https://badyvlegwumldciibxfe.supabase.co/functions/v1/import-listing'),
    timeoutMs:Number(existingListing.timeoutMs)||30000,
    readerFallback:existingListing.readerFallback!==false,
    readerBaseUrl:String(existingListing.readerBaseUrl||'https://r.jina.ai/')
  },
  listingSearch:{
    endpoint:String(existingListingSearch.endpoint||'https://badyvlegwumldciibxfe.supabase.co/functions/v1/search-listings'),
    timeoutMs:Number(existingListingSearch.timeoutMs)||90000,
    pages:Number(existingListingSearch.pages)||2,
    limitPerSource:Number(existingListingSearch.limitPerSource)||25
  },
  geocoding:{
    provider:String(existingGeocoding.provider||'yandexHttp'),
    directBaseUrl:String(existingGeocoding.directBaseUrl||'https://geocode-maps.yandex.ru/v1/'),
    // Резервный серверный маршрут на случай, если браузер блокирует CORS к HTTP Геокодеру.
    endpoint:String(existingGeocoding.endpoint||'https://badyvlegwumldciibxfe.supabase.co/functions/v1/geocode-address'),
    timeoutMs:Number(existingGeocoding.timeoutMs)||12000,
    useServerFallback:existingGeocoding.useServerFallback!==false,
    searchCenter:String(existingGeocoding.searchCenter||'37.6176,55.7558'),
    searchSpan:String(existingGeocoding.searchSpan||'4.2,3.0')
  },
  competitiveAnalysis:{
    // Конкурентный анализ загружается пользователем вручную из XLSX.
    // Программа всегда читает лист «Свод» целиком и не обращается к Google Sheets.
    provider:'manualXlsx',
    sheetName:'Свод',
    staleAfterMs:Number(existingCompetitive.staleAfterMs)||30*24*60*60*1000,
    cacheSchemaVersion:64,
    mapping:Object.assign({
      clusterName:'Кластер',
      rating:'Рейтинг(население важнее)',
      averageRentPerSqm:'м2 семейный аренда'
    },existingCompetitive.mapping||{})
  }
};
})();
