'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'search-space-card-modal.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'search-space-card-modal.css'), 'utf8');
const CARD_MODEL = require(path.join(ROOT, 'search-space-card.js'));

function loadApi(model) {
  const window = { SlogiSearchSpaceCard: model || null };
  const document = {};
  vm.runInNewContext(SOURCE, { window, document, Intl, Number, Object, Array, String, Boolean, Math, Set });
  return window.SlogiSearchSpaceCardModal;
}

test('modal exposes one shared manual/parsed card contract', () => {
  const api = loadApi();
  const card = api.normalize({
    source: 'cian',
    address: 'Москва, ул. Тестовая, 1',
    clusterId: 'cluster-1',
    clusterName: 'Лефортово',
    clusterRank: 12,
    averageRentPerSqm: 4000,
    rentMonthly: 480000,
    area: 120,
    areaConfirmed: true,
    separateEntrance: true,
    hasWindows: true,
    windowsOpen: false,
    ceilingHeight: 3.4,
    ceilingHeightConfirmed: true,
    repair: 'finished',
    hasSlogiCenter: false
  });

  assert.equal(card.source, 'parsed');
  assert.equal(card.cluster.name, 'Лефортово');
  assert.equal(card.competitive.isTop30, true);
  assert.equal(api.evaluate(card).canTakeToWork, true);
  assert.equal(api.evaluate(card).computed.rentPerSqm, 4000);
});

test('take-to-work gate reports occupied cluster, ranking and missing exact values', () => {
  const api = loadApi();
  const evaluation = api.evaluate(api.normalize({
    address: 'Москва',
    cluster: { id: 'cluster-44', matched: true, hasSlogiCenter: true },
    competitive: { rank: 44, isTop30: false }
  }));

  assert.equal(evaluation.canTakeToWork, false);
  assert.match(evaluation.reasons.join(' '), /уже есть открытый центр Слоги/i);
  assert.match(evaluation.reasons.join(' '), /не входит в ТОП-30/i);
  assert.match(evaluation.missing.join(' '), /стоимость аренды/i);
  assert.match(evaluation.missing.join(' '), /состояние ремонта/i);
});

test('outside-cluster state is explicit and blocks transition', () => {
  const api = loadApi(CARD_MODEL);
  const evaluation = api.evaluate(api.normalize({
    address: 'Московская область',
    cluster: { matched: false, hasSlogiCenter: false },
    competitive: { isTop30: false }
  }));
  assert.equal(evaluation.canTakeToWork, false);
  assert.match(evaluation.reasons.join(' '), /не попало ни в один кластер/i);
});

test('adapter keeps unknown choices empty and renders model reason codes as Russian guidance', () => {
  const api = loadApi(CARD_MODEL);
  const card = api.normalize({ address: 'Москва' });
  const evaluation = api.evaluate(card);

  assert.equal(card.areaConfirmed, null);
  assert.equal(card.ceilingHeightConfirmed, null);
  assert.ok(evaluation.reasons.every((reason) => !/^[a-z_]+$/.test(reason)), evaluation.reasons.join(', '));
  assert.match(evaluation.missing.join(' '), /стоимость аренды/i);
  assert.match(evaluation.missing.join(' '), /средней стоимости аренды/i);
});

test('round-trip preserves outside status, center details, source provider, work and explicit top-30', () => {
  const api = loadApi(CARD_MODEL);
  const card = api.normalize({
    source: 'parsed',
    sourceProvider: 'cian',
    cluster: { status: 'outside', centerDetails: 'Центр на соседней улице' },
    competitive: { isTop30: true },
    work: { status: 'draft', owner: 'team' }
  });

  assert.equal(card.cluster.status, 'outside');
  assert.equal(card.cluster.matched, false);
  assert.equal(card.cluster.centerDetails, 'Центр на соседней улице');
  assert.equal(card.sourceProvider, 'cian');
  assert.equal(card.competitive.isTop30, true);
  assert.equal(JSON.stringify(card.work), JSON.stringify({ status: 'draft', owner: 'team' }));
});

test('successful mutating callbacks use a forced close while action is busy', () => {
  assert.match(SOURCE, /if \(closeAfter\) close\([^;]+, true\);/);
  assert.match(SOURCE, /function close\(reason, force\)/);
  assert.match(SOURCE, /\(state\.busy && !force\)/);
});

test('markup and styles preserve accessible labels, live feedback and responsive layout', () => {
  assert.match(SOURCE, /<dialog[^>]+aria-labelledby="ss-card-title"/);
  assert.match(SOURCE, /role="status" aria-live="polite"/);
  assert.match(SOURCE, /aria-describedby="ss-card-take-help"/);
  assert.match(SOURCE, /choice\('windowsOpen', 'true', 'Да'\)/);
  assert.match(SOURCE, /choice\('repair', 'none', 'Нет ремонта'\)/);
  assert.match(SOURCE, /choice\('repair', 'rough', 'Черновой'\)/);
  assert.match(SOURCE, /choice\('repair', 'finished', 'Чистовой'\)/);
  assert.match(CSS, /@media \(max-width: 540px\)/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media \(forced-colors: active\)/);
});
