'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const cardModel = require(path.join(ROOT, 'search-space-card.js'));
const servicesSource = read('phase0-services.js');
const workspaceSource = read('cian-workspace.js');
const pageSource = read('available-spaces.html');

function methodBody(source, name, nextName) {
  const start = source.indexOf(`  ${name}(`);
  const end = source.indexOf(`\n  ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} method is missing`);
  assert.notEqual(end, -1, `${nextName} method boundary is missing`);
  return source.slice(start, end);
}

function readyCard(overrides = {}) {
  const base = {
    source: 'manual',
    address: 'Москва, Тестовая улица, 1',
    cluster: { id: 'cluster-1', name: 'Кластер 1', status: 'inside', hasSlogiCenter: false },
    competitive: { rating: 12, rank: 12, averageRentPerSqm: 3000 },
    rentMonthly: 360000,
    area: 120,
    areaConfirmed: true,
    separateEntrance: true,
    hasWindows: true,
    windowsOpen: true,
    ceilingHeight: 3.2,
    ceilingHeightConfirmed: true,
    repair: 'finished'
  };
  return Object.assign({}, base, overrides, {
    cluster: Object.assign({}, base.cluster, overrides.cluster || {}),
    competitive: Object.assign({}, base.competitive, overrides.competitive || {})
  });
}

function serviceHarness({ card, geo = null, locate, metric = null, otherProjects = [] }) {
  const sharedState = { settings: {} };
  const window = {
    SlogiPro: {
      readLocations: () => [],
      writeLocations: () => {},
      read: () => sharedState,
      write: () => {},
      actor: () => 'integration-test',
      uid: (prefix) => `${prefix}-test`,
      activity: () => {}
    },
    SlogiWorkflow: {},
    SlogiSearchSpaceCard: cardModel,
    SLOGI_PHASE0_CONFIG: { competitiveAnalysis: { provider: 'none', cacheSchemaVersion: 1 } },
    SLOGI_CLUSTERS_GEOJSON: { type: 'FeatureCollection', features: [] }
  };
  const sandbox = { window, URL, AbortController, setTimeout, clearTimeout, console };
  vm.runInNewContext(servicesSource, sandbox, { filename: 'phase0-services.js' });
  const api = window.SlogiPhase0;
  api.clusterService.locate = locate || (() => ({ status: 'invalid', clusterId: '', clusterName: '' }));

  let current = {
    id: 'space-1',
    address: card.address,
    geo,
    clusterId: card.cluster && card.cluster.id || '',
    clusterName: card.cluster && card.cluster.name || '',
    phase0: { revision: 1, spaceCard: JSON.parse(JSON.stringify(card)) }
  };
  const repository = {
    get: (id) => String(id) === current.id ? JSON.parse(JSON.stringify(current)) : null,
    listAll: () => [current, ...otherProjects].map(project => JSON.parse(JSON.stringify(project))),
    mutate: (id, mutator) => {
      assert.equal(String(id), current.id);
      current = mutator(JSON.parse(JSON.stringify(current)));
      current.phase0.revision = Number(current.phase0.revision || 0) + 1;
      return JSON.parse(JSON.stringify(current));
    }
  };
  const competitive = { metricFor: () => metric, snapshot: () => ({ rows: [] }) };
  const audit = { record: () => {}, recordSave: () => {}, recordRating: () => {} };
  const service = new api.Phase0Service({ projectRepository: repository, competitiveRepository: competitive, fileService: {}, auditService: audit });
  return { service, current: () => current };
}

function manualReadyCard(overrides = {}) {
  return readyCard(Object.assign({}, overrides, {
    cluster: Object.assign({ resolutionSource: 'manual' }, overrides.cluster || {}),
    competitive: Object.assign({ resolutionSource: 'manual' }, overrides.competitive || {})
  }));
}

test('the search page loads one shared card model before the modal and workspace', () => {
  const model = pageSource.indexOf('search-space-card.js');
  const modal = pageSource.indexOf('search-space-card-modal.js');
  const workspace = pageSource.indexOf('cian-workspace.js');
  assert.ok(model >= 0 && modal > model && workspace > modal);
  assert.match(pageSource, /id="available-add-space"[^>]*>Добавить помещение</);
  assert.match(workspaceSource, /cardForProject\(/);
  assert.match(workspaceSource, /cardForListing\(/);
  assert.match(workspaceSource, /data-take-space=/);
  assert.match(workspaceSource, /data-remove-space=/);
});

test('the model blocks outside, occupied, non-top-30 and incomplete cards', () => {
  assert.equal(cardModel.normalize(readyCard()).canTakeToWork, true);
  assert.equal(cardModel.normalize(readyCard({ cluster: { status: 'outside' } })).canTakeToWork, false);
  assert.equal(cardModel.normalize(readyCard({ cluster: { hasSlogiCenter: true } })).canTakeToWork, false);
  assert.equal(cardModel.normalize(readyCard({ competitive: { rank: 31 } })).canTakeToWork, false);
  assert.equal(cardModel.normalize(readyCard({ separateEntrance: null })).canTakeToWork, false);
});

test('missing competitive rank stays unknown instead of being reported as outside TOP-30', () => {
  const card = cardModel.normalize(readyCard({ competitive: { rank: null } }));
  assert.equal(card.competitive.rank, null);
  assert.equal(card.competitive.isTop30, null,
    'No imported rating means “нет данных”, which is different from a known rank below the TOP-30 cutoff.');
  assert.ok(card.eligibility.reasons.includes('cluster_rank_unknown'));
});

test('TOP-30 uses the business rating value, which is already the rank', () => {
  const body = methodBody(servicesSource, 'competitiveProfile', 'openCentersInCluster');
  assert.doesNotMatch(body, /rank\s*=\s*index\s*>=\s*0\s*\?\s*index\s*\+\s*1/,
    'Do not renumber the imported rating rows: a business rating of 50 must not become rank 2 merely because only two rows are loaded.');
  assert.match(body, /rating\s*=\s*metric\s*&&\s*nullableNumber\(metric\.rating\)[\s\S]*rank\s*=\s*rating\s*!=\s*null\s*&&\s*rating\s*>=\s*1\s*\?\s*Math\.trunc\(rating\)\s*:\s*null/,
    'The imported “РЕЙТИНГ(Население важнее)” is documented as the ordinal place (1 is best), so it must directly drive TOP-30.');
});

test('takeSpaceIntoWork revalidates the exact cluster from persisted coordinates', () => {
  const body = methodBody(servicesSource, 'takeSpaceIntoWork', 'readiness');
  assert.match(body, /normalizeGeo\s*\(\s*current\.geo\s*\)|projectGeo\s*\(\s*current\s*\)/,
    'The transition gate must read persisted coordinates, not trust a stored cluster id/name.');
  assert.match(body, /clusterService\.locate\s*\(|\.locate\s*\([^)]*geo/,
    'The transition gate must re-run exact polygon containment before changing status to “В работе”.');
});

test('taking into work rechecks current occupancy and competitive data before mutation', () => {
  const body = methodBody(servicesSource, 'takeSpaceIntoWork', 'readiness');
  const contextCall = body.indexOf('this.takeSpaceContext(');
  const evaluateCall = body.indexOf('model.evaluate(');
  const mutation = body.indexOf('this.projects.mutate(');
  assert.ok(contextCall >= 0 && evaluateCall > contextCall && mutation > evaluateCall);
  assert.match(body, /if\s*\(\s*!gate\.canTakeToWork\s*\)\s*throw/);
  const contextStart = servicesSource.indexOf('  takeSpaceContext(');
  const contextEnd = servicesSource.indexOf('\n  async resolveSpaceAddress(', contextStart);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  const contextBody = servicesSource.slice(contextStart, contextEnd);
  assert.match(contextBody, /this\.spaceContext\(/);
  assert.match(contextBody, /this\.manualSpaceContext\(/);
});

test('an explicit complete manual context can be taken into work when automatic location is unavailable', () => {
  const card = manualReadyCard({ competitive: { rating: null } });
  const { service } = serviceHarness({ card });
  const saved = service.takeSpaceIntoWork('space-1');
  assert.equal(saved.status, 'В работе');
  assert.equal(saved.phase0.spaceCard.cluster.id, 'cluster-1');
  assert.equal(saved.phase0.spaceCard.cluster.resolutionSource, 'manual');
  assert.equal(saved.phase0.spaceCard.competitive.rank, 12);
  assert.equal(saved.phase0.spaceCard.competitive.rating, 12);
  assert.equal(saved.phase0.spaceCard.competitive.averageRentPerSqm, 3000);
  assert.equal(saved.phase0.spaceCard.competitive.resolutionSource, 'manual');
});

test('exact polygon containment overrides a conflicting manually selected cluster', () => {
  const card = manualReadyCard({ cluster: { id: 'manual-cluster', name: 'Ручной кластер' }, competitive: { rank: 3, rating: 3, averageRentPerSqm: 2500 } });
  const { service } = serviceHarness({
    card,
    geo: { lat: 55.7, lng: 37.6 },
    locate: () => ({ status: 'inside', clusterId: 'auto-cluster', clusterName: 'Точный кластер' }),
    metric: { rating: 18, averageRentPerSqm: 4100 }
  });
  const saved = service.takeSpaceIntoWork('space-1');
  assert.equal(saved.phase0.spaceCard.cluster.id, 'auto-cluster');
  assert.equal(saved.phase0.spaceCard.cluster.resolutionSource, 'automatic');
  assert.equal(saved.phase0.spaceCard.competitive.rank, 18);
  assert.equal(saved.phase0.spaceCard.competitive.averageRentPerSqm, 4100);
  assert.equal(saved.phase0.spaceCard.competitive.resolutionSource, 'automatic');
});

test('a currently known open center blocks a manual free-cluster assertion', () => {
  const card = manualReadyCard({ cluster: { hasSlogiCenter: false } });
  const center = { id: 'center-2', clusterId: 'cluster-1', clusterName: 'Кластер 1', centerName: 'СЛОГИ Тест', isSlogiCenterOpen: true };
  const { service } = serviceHarness({ card, otherProjects: [center] });
  assert.throws(
    () => service.takeSpaceIntoWork('space-1'),
    error => error.code === 'SPACE_WORK_BLOCKED' && error.details.card.cluster.hasSlogiCenter === true && error.details.gate.reasons.includes('cluster_occupied')
  );
});

test('system competitive data overrides manual rank and average for a manual cluster', () => {
  const card = manualReadyCard({ competitive: { rank: 5, rating: 5, averageRentPerSqm: 2800 } });
  const { service } = serviceHarness({ card, metric: { rating: 41, averageRentPerSqm: 4700 } });
  assert.throws(
    () => service.takeSpaceIntoWork('space-1'),
    error => error.code === 'SPACE_WORK_BLOCKED' && error.details.card.competitive.rank === 41 && error.details.card.competitive.averageRentPerSqm === 4700 && error.details.card.competitive.resolutionSource === 'automatic'
  );
});

test('manual competitive data fills only fields missing from a partial system profile', () => {
  const card = manualReadyCard({ competitive: { rating: null, rank: 5, averageRentPerSqm: 2800 } });
  const { service } = serviceHarness({ card, metric: { rating: null, averageRentPerSqm: 4700 } });
  const saved = service.takeSpaceIntoWork('space-1');
  assert.equal(saved.phase0.spaceCard.competitive.rank, 5);
  assert.equal(saved.phase0.spaceCard.competitive.rating, 5);
  assert.equal(saved.phase0.spaceCard.competitive.averageRentPerSqm, 4700);
  assert.equal(saved.phase0.spaceCard.competitive.resolutionSource, 'manual');
});

test('manual fallback is rejected unless its source and required potential fields are explicit', () => {
  const card = readyCard();
  const { service } = serviceHarness({ card });
  assert.throws(
    () => service.takeSpaceIntoWork('space-1'),
    error => error.code === 'SPACE_WORK_BLOCKED' && error.details.gate.reasons.includes('cluster_not_confirmed')
  );
});

test('space-card saving and work transition never use a nearest-cluster fallback', () => {
  const buildBody = methodBody(servicesSource, 'buildCandidate', 'validate');
  const takeBody = methodBody(servicesSource, 'takeSpaceIntoWork', 'readiness');
  assert.doesNotMatch(buildBody, /findNearestByCoordinates/);
  assert.doesNotMatch(takeBody, /findNearestByCoordinates/);
});

test('the unified card is persisted and saved projects are soft-deleted', () => {
  assert.match(servicesSource, /clusterSnapshot:null,spaceCard:null,transition:null/);
  assert.match(servicesSource, /spaceCard=draft\.spaceCard&&typeof draft\.spaceCard==='object'\?clone\(draft\.spaceCard\)/);
  assert.match(workspaceSource, /return\{spaceCard:cardData,/);
  const removeStart = workspaceSource.indexOf('  async function removeSpace(');
  const removeEnd = workspaceSource.indexOf('\n  async function takeSpace(', removeStart);
  assert.ok(removeStart >= 0 && removeEnd > removeStart);
  const removeBody = workspaceSource.slice(removeStart, removeEnd);
  assert.match(removeBody, /projectRepository\(\)\.softDelete\(item\._projectId\)/);
  assert.match(removeBody, /suppressListing\(freshnessId\(item\)\)/);
  assert.match(removeBody, /await syncWorkspace\(\)/);
  assert.match(workspaceSource, /settings\.cianHiddenListingIds=/,
    'Unsaved parsed listings must be suppressed in the shared workspace, not only on one device.');
});

test('open-center occupancy uses operational evidence, ignores deleted projects and excludes the current card', () => {
  const body = methodBody(servicesSource, 'openCentersInCluster', 'spaceContext');
  assert.match(body, /this\.projects\.listAll\(\)/);
  assert.match(body, /String\(project\.id\)===String\(excludeProjectId\|\|''\)/);
  assert.match(body, /isSlogiCenterOpen===true/);
  assert.match(body, /actualOpeningDate/);
  assert.match(servicesSource, /listAll\(\)\{return P\.readLocations\(\)\.filter\(x=>x&&x\.id&&!x\.deletedAt\)\}/);
});

test('editing an address invalidates stale cluster and competitive results', () => {
  const modalSource = read('search-space-card-modal.js');
  assert.match(modalSource, /event\.target\.name\s*===\s*'address'[\s\S]*state\.draft\.cluster\s*=\s*\{\s*id:\s*'',\s*name:\s*''/);
  assert.match(modalSource, /event\.target\.name\s*===\s*'address'[\s\S]*state\.draft\.competitive\s*=\s*\{\s*rating:\s*null,\s*rank:\s*null/);
});

test('an address-only district hint is never presented as exact polygon containment', () => {
  const modalSource = read('search-space-card-modal.js');
  const start = modalSource.indexOf('  function renderLocation(');
  const end = modalSource.indexOf('\n  function renderEconomy(', start);
  assert.ok(start >= 0 && end > start);
  const body = modalSource.slice(start, end);
  assert.doesNotMatch(body, /cluster\.status\s*===\s*'inside'\s*\|\|\s*card\.cluster\.status\s*===\s*'address'/,
    'The “address” state is an administrative text fallback, not proof that coordinates are inside a SLOGI polygon. It must not say “входит в границы кластера”.');
});
