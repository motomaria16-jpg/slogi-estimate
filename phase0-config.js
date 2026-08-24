(function(){
'use strict';

const existing=window.SLOGI_PHASE0_CONFIG||{};
const existingListing=existing.listingImport||{};
const existingCompetitive=existing.competitiveAnalysis||{};
const existingGeocoding=existing.geocoding||{};
const existingListingSearch=existing.listingSearch||{};
const existingSupabase=existing.supabase||{};
const existingWorkspace=existing.sharedWorkspace||{};

// Release candidates are inert until a deployment-specific runtime override is
// supplied. Publishing static files must not contact or mutate production.
const defaultSupabaseUrl='https://badyvlegwumldciibxfe.supabase.co';
const defaultPublishableKey='sb_publishable_Pe0ZW2FANEERMm62k53mvw_4i0s5-nb';
const functionEndpoint=(configured,name)=>String(configured||(defaultSupabaseUrl?defaultSupabaseUrl+'/functions/v1/'+name:''));

window.SLOGI_PHASE0_CONFIG={
  listingImport:{
    endpoint:functionEndpoint(existingListing.endpoint,'import-listing'),
    timeoutMs:Number(existingListing.timeoutMs)||30000,
    source:'cian'
  },
  listingSearch:{
    endpoint:functionEndpoint(existingListingSearch.endpoint,'search-listings'),
    timeoutMs:Number(existingListingSearch.timeoutMs)||30000,
    limit:Number(existingListingSearch.limit)||50,
    source:'cian'
  },
  supabase:{
    url:String(existingSupabase.url||defaultSupabaseUrl),
    publishableKey:String(existingSupabase.publishableKey||defaultPublishableKey)
  },
  sharedWorkspace:{
    joinEndpoint:functionEndpoint(existingWorkspace.joinEndpoint,'join-workspace'),
    sessionStorageKey:'slogi_anonymous_session_v1',
    connectionStorageKey:'slogi_shared_workspace_connection_v1',
    stateCacheKey:'slogi_shared_workspace_cache_v1'
  },
  geocoding:{
    provider:String(existingGeocoding.provider||'yandexHttp'),
    directBaseUrl:String(existingGeocoding.directBaseUrl||'https://geocode-maps.yandex.ru/v1/'),
    // Резервный серверный маршрут на случай, если браузер блокирует CORS к HTTP Геокодеру.
    endpoint:functionEndpoint(existingGeocoding.endpoint,'geocode-address'),
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
