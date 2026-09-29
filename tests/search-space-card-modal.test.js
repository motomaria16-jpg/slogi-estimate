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
  vm.runInNewContext(SOURCE, { window, document, Intl, Number, Object, Array, String, Boolean, Math, Set, URL });
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
  assert.equal(card.competitive.isTop35, true);
  assert.equal(api.evaluate(card).canTakeToWork, true);
  assert.equal(api.evaluate(card).computed.rentPerSqm, 4000);
});

test('take-to-work gate reports occupied cluster, ranking and missing exact values', () => {
  const api = loadApi();
  const evaluation = api.evaluate(api.normalize({
    address: 'Москва',
    cluster: { id: 'cluster-44', matched: true, hasSlogiCenter: true },
    competitive: { rank: 44, isTop35: false }
  }));

  assert.equal(evaluation.canTakeToWork, false);
  assert.match(evaluation.reasons.join(' '), /уже есть открытый центр Слоги/i);
  assert.match(evaluation.reasons.join(' '), /ниже ТОП-35/i);
  assert.match(evaluation.missing.join(' '), /стоимость аренды/i);
  assert.match(evaluation.missing.join(' '), /состояние ремонта/i);
});

test('outside-cluster state is explicit and blocks transition', () => {
  const api = loadApi(CARD_MODEL);
  const evaluation = api.evaluate(api.normalize({
    address: 'Московская область',
    cluster: { matched: false, hasSlogiCenter: false },
    competitive: { isTop35: false }
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

test('round-trip preserves outside status, center details, source provider, work and explicit top-35', () => {
  const api = loadApi(CARD_MODEL);
  const card = api.normalize({
    source: 'parsed',
    sourceProvider: 'cian',
    cluster: { status: 'outside', centerDetails: 'Центр на соседней улице' },
    competitive: { rank: 33, isTop35: true },
    work: { status: 'draft', owner: 'team' }
  });

  assert.equal(card.cluster.status, 'outside');
  assert.equal(card.cluster.matched, false);
  assert.equal(card.cluster.centerDetails, 'Центр на соседней улице');
  assert.equal(card.sourceProvider, 'cian');
  assert.equal(card.competitive.isTop35, true);
  assert.equal(JSON.stringify(card.work), JSON.stringify({ status: 'draft', owner: 'team' }));
});

test('manual location fallback stays in the shared card and can satisfy the local strict gate', () => {
  const api = loadApi(CARD_MODEL);
  const card = api.normalize({
    source: 'parsed',
    address: 'Москва, шоссе Энтузиастов, 3',
    cluster: { name: 'Лефортово', status: 'inside', hasSlogiCenter: false, resolutionSource: 'manual' },
    competitive: { rank: 9, averageRentPerSqm: 4000, resolutionSource: 'manual' },
    rentMonthly: 480000,
    area: 120,
    areaConfirmed: true,
    separateEntrance: true,
    hasWindows: false,
    ceilingHeight: 3.2,
    ceilingHeightConfirmed: true,
    repair: 'rough'
  });

  assert.equal(card.cluster.resolutionSource, 'manual');
  assert.equal(card.competitive.resolutionSource, 'manual');
  assert.equal(api.evaluate(card).canTakeToWork, true);
});

test('successful mutating callbacks use a forced close while action is busy', () => {
  assert.match(SOURCE, /if \(closeAfter\) close\([^;]+, true\);/);
  assert.match(SOURCE, /function close\(reason, force\)/);
  assert.match(SOURCE, /\(state\.busy && !force\)/);
});

test('workflow extension is opt-in and restricted to the in-work card context', () => {
  assert.match(SOURCE, /state\.context === 'in-work' && typeof state\.callbacks\.renderWorkflow === 'function'/);
  assert.match(SOURCE, /data-workflow-section[^>]+hidden/);
  assert.match(SOURCE, /data-card-tab="workflow">Сопровождение/);
  assert.match(SOURCE, /data-card-tab="history">История/);
  assert.match(SOURCE, /onWorkflowAction/);
  assert.match(SOURCE, /onWorkflowFile/);
  assert.match(SOURCE, /new window\.FormData\(state\.form\)/);
  assert.match(SOURCE, /event\.target\.closest\('\[data-workflow-section\]'\)/);
  assert.match(SOURCE, /takeButton\.hidden = state\.context === 'in-work'/);
  assert.match(SOURCE, /rendered\.historyHtml/);
  assert.match(SOURCE, /state\.workflowView\.sidebarHtml/);
  assert.match(SOURCE, /data-action="start-proposal" data-workflow-footer-action hidden/);
  assert.match(SOURCE, /function renderWorkflowFooterAction\(\)/);
  assert.match(SOURCE, /button\.matches\('\[data-workflow-footer-action\]'\)/);
  assert.match(CSS, /\.ss-card-workflow-content \{ display: grid; grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(CSS, /\.ss-card-history-content \{ display: grid/);
});

test('markup is compact, accessible and uses one editable control per value', () => {
  assert.match(SOURCE, /<dialog[^>]+aria-labelledby="ss-card-title"/);
  assert.match(SOURCE, /class="ss-card-identity"/);
  assert.match(SOURCE, /class="ss-card-columns"/);
  assert.match(SOURCE, /role="tablist"/);
  for (const tab of ['object','workflow','history']) {
    assert.match(SOURCE, new RegExp(`role="tab"[^>]+data-card-tab="${tab}"`));
    assert.match(SOURCE, new RegExp(`role="tabpanel"[^>]+data-card-panel="${tab}"`));
  }
  assert.doesNotMatch(SOURCE, /data-card-tab="selection"|>Отбор<|data-selection-detail/);
  assert.match(SOURCE, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(SOURCE, /Кластер и рейтинг/);
  assert.match(SOURCE, />Экономика</);
  assert.match(SOURCE, /Технические условия/);
  assert.match(SOURCE, /choice\('windowsOpen', 'true', 'Да'\)/);
  assert.match(SOURCE, /choice\('areaConfirmed', 'true', 'Да'\)/);
  assert.match(SOURCE, /Площадь соответствует диапазону 90–150 м²/);
  assert.match(SOURCE, /value === 'yes' \|\| value === true/);
  assert.match(SOURCE, /value === 'no' \|\| value === false/);
  assert.match(SOURCE, /<select name="repair">/);
  assert.match(SOURCE, /<option value="none">Бетон<\/option>/);
  assert.match(SOURCE, /<option value="rough">Черновой<\/option>/);
  assert.match(SOURCE, /<option value="finished">Чистовой<\/option>/);
  assert.match(SOURCE, /name="listingUrl"/);
  assert.match(SOURCE, /rel="noopener noreferrer"/);
  assert.match(SOURCE, /name="latitudeManual"/);
  assert.match(SOURCE, /name="longitudeManual"/);
  assert.match(SOURCE, /name="clusterNameManual"/);
  assert.match(SOURCE, /name="centerDetailsManual"/);
  assert.match(SOURCE, /name="clusterRankManual"/);
  assert.match(SOURCE, /name="clusterRatingManual"/);
  assert.match(SOURCE, /name="averageRentManual"/);
  assert.match(SOURCE, /name="pricePerSqm"/);
  assert.match(SOURCE, /name="comparisonPercent"/);
  assert.match(SOURCE, /ТОП-35/);
  assert.doesNotMatch(SOURCE, /подходит|не подходит/i);
  assert.doesNotMatch(SOURCE, /Вопросы собственнику/i);
  assert.doesNotMatch(SOURCE, /Ручные данные|data-manual-location|ss-card-status-card|data-status="(?:cluster|center|ranking)"/);
  assert.match(SOURCE, /data-header-address/);
  ['address','listingUrl','latitudeManual','longitudeManual','clusterNameManual','centerDetailsManual','clusterRankManual','clusterRatingManual','rentMonthly','area','pricePerSqm','averageRentManual','comparisonPercent','ceilingHeight'].forEach((name) => {
    assert.equal((SOURCE.match(new RegExp(`name="${name}"`, 'g')) || []).length, 1, `${name} must have one form control`);
  });
  Object.entries({
    clusterStatusManual: 2,
    hasSlogiCenterManual: 2,
    areaConfirmed: 2,
    separateEntrance: 2,
    hasWindows: 2,
    windowsOpen: 2,
    ceilingHeightConfirmed: 2
  }).forEach(([name, expectedChoices]) => {
    assert.equal((SOURCE.match(new RegExp(`choice\\('${name}'`, 'g')) || []).length, expectedChoices, `${name} must have one radio group`);
  });
  assert.match(SOURCE, /resolutionSource: groups\.cluster \? 'manual'/);
  assert.match(SOURCE, /resolutionSource: groups\.competitive \? 'manual'/);
  assert.match(SOURCE, /resolutionSource: groups\.coordinates \? 'manual'/);
  assert.match(SOURCE, /current\.pricePerSqmOverride/);
  assert.match(SOURCE, /current\.competitive\.comparisonPercentOverride/);
  assert.match(CSS, /input\[value="true"\]:checked/);
  assert.match(CSS, /input\[value="false"\]:checked/);
  assert.match(CSS, /\.ss-card-identity \{[^}]*grid-template-columns:/);
  assert.match(CSS, /\.ss-card-layout \{[^}]*grid-template-columns: minmax\(0,1fr\) 278px/);
  assert.match(CSS, /\.ss-card-columns \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(CSS, /\.ss-card-row \{[^}]*min-height: 29px/);
  assert.match(CSS, /\.ss-card-choice span \{[^}]*min-height: 26px/);
  assert.doesNotMatch(CSS, /\.ss-card-status-card|\.ss-card-manual(?:\s|\{|\.)/);
  assert.match(CSS, /\.ss-card-center-choice \.ss-card-choice input\[value="true"\]:checked \+ span \{[^}]*var\(--ss-card-danger\)/);
  assert.match(CSS, /\.ss-card-center-choice \.ss-card-choice input\[value="false"\]:checked \+ span \{[^}]*#2f6941/);
  assert.match(CSS, /@media \(max-width: 1080px\)/);
  assert.match(CSS, /@media \(max-width: 820px\)/);
  assert.match(CSS, /@media \(max-width: 680px\)/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(SOURCE, /Решение специалиста|data-readiness-title|data-reasons|data-take-help/);
  assert.match(SOURCE, /'take-to-work'/);
  assert.match(SOURCE, /Добавить в «Помещение в работе»/);
  assert.doesNotMatch(SOURCE, /data-action="take-to-work"\s+disabled/);
  assert.doesNotMatch(SOURCE, /name === 'onTakeToWork' && !state\.evaluation\.canTakeToWork/);
});

test('input flow preserves in-progress address and calculated-field edits', () => {
  const addressStart = SOURCE.indexOf("      if (event.target.name === 'address') {");
  const derivedStart = SOURCE.indexOf("      if (event.target.name === 'pricePerSqm'", addressStart);
  assert.ok(addressStart >= 0 && derivedStart > addressStart);
  const addressInputBody = SOURCE.slice(addressStart, derivedStart);
  assert.match(addressInputBody, /state\.draft\.address = event\.target\.value/);
  assert.match(addressInputBody, /setControl\('clusterNameManual', ''\)/);
  assert.match(addressInputBody, /setControl\('clusterRankManual', null\)/);
  assert.match(addressInputBody, /setControl\('averageRentManual', null\)/);
  assert.doesNotMatch(addressInputBody, /collectDraft|fillForm/);
  assert.match(SOURCE, /event\.target\.name === 'pricePerSqm' \|\| event\.target\.name === 'comparisonPercent'\) return/);
  assert.match(SOURCE, /document\.activeElement === control\) return/);
  assert.match(SOURCE, /addEventListener\('focusout', finishDeferredEdit\)/);
  assert.match(SOURCE, /name="comparisonPercent" type="text"[^>]+pattern="-\?\[0-9\]/);
});
