import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(dirname(fileURLToPath(import.meta.url))));
const chromePath = String(process.env.SLOGI_LOCAL_CHROME || '');
const nodeModules = String(process.env.SLOGI_NODE_MODULES || '');
const hasBrowserRuntime = Boolean(chromePath && nodeModules && existsSync(chromePath));

test('browser editing keeps address spaces and defers calculated-field replacement until blur', { skip: !hasBrowserRuntime }, async () => {
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href);
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<!doctype html><html lang="ru"><body><button id="opener">Открыть</button></body></html>');
    await page.addStyleTag({ path: join(root, 'search-space-card-modal.css') });
    await page.addScriptTag({ path: join(root, 'search-space-card.js') });
    await page.addScriptTag({ path: join(root, 'search-space-card-modal.js') });
    await page.evaluate(() => {
      window.SlogiSearchSpaceCardModal.open({
        initial: {
          id: 'space-1',
          source: 'cian',
          sourceProvider: 'cian',
          listingUrl: 'https://example.com/listing',
          address: 'Москва',
          geo: { lat: 55.75, lng: 37.61, resolutionSource: 'automatic' },
          cluster: { name: 'Лефортово', status: 'inside', hasSlogiCenter: false, centerDetails: 'Свободен', resolutionSource: 'automatic' },
          competitive: { rating: 92, rank: 12, averageRentPerSqm: 3200, resolutionSource: 'automatic' },
          rentMonthly: 480000,
          area: 120,
          areaConfirmed: true,
          separateEntrance: true,
          hasWindows: true,
          windowsOpen: true,
          ceilingHeight: 3.4,
          ceilingHeightConfirmed: true,
          repair: 'finished',
          work: { status: 'draft', marker: 'preserve-me' }
        },
        opener: document.getElementById('opener'),
        onSave(card) {
          window.__savedSpaceCard = card;
          return false;
        },
        onTakeToWork(card, evaluation) {
          window.__takenSpaceCard = card;
          window.__takenEvaluation = evaluation;
          return false;
        }
      });
    });

    for (const viewport of [
      { width: 1280, height: 900, layoutColumns: 2, sectionColumns: 2 },
      { width: 1024, height: 800, layoutColumns: 2, sectionColumns: 2 },
      { width: 981, height: 800, layoutColumns: 2, sectionColumns: 2 },
      { width: 681, height: 760, layoutColumns: 1, sectionColumns: 2 },
      { width: 375, height: 760, layoutColumns: 1, sectionColumns: 1 },
      { width: 320, height: 700, layoutColumns: 1, sectionColumns: 1 }
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.locator('#slogi-search-space-card-dialog').evaluate(dialog => ({
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        bodyOverflow: dialog.querySelector('.ss-card-body').scrollWidth - dialog.querySelector('.ss-card-body').clientWidth,
        layoutColumns: getComputedStyle(dialog.querySelector('.ss-card-layout')).gridTemplateColumns,
        sectionColumns: getComputedStyle(dialog.querySelector('.ss-card-columns')).gridTemplateColumns,
        coordinatesWidth: dialog.querySelector('.ss-card-coordinates').getBoundingClientRect().width,
        coordinateInputWidths: Array.from(dialog.querySelectorAll('.ss-card-coordinate-inputs input'), input => input.getBoundingClientRect().width),
        coordinateColumnStart: getComputedStyle(dialog.querySelector('.ss-card-coordinates')).gridColumnStart,
        coordinateColumnEnd: getComputedStyle(dialog.querySelector('.ss-card-coordinates')).gridColumnEnd,
        listingLinkHidden: dialog.querySelector('[data-listing-field-link]').hidden
      }));
      assert.ok(geometry.dialogOverflow <= 1, `dialog must not overflow at ${viewport.width}px`);
      assert.ok(geometry.bodyOverflow <= 1, `body must not overflow at ${viewport.width}px (overflow: ${geometry.bodyOverflow}px)`);
      assert.equal(geometry.layoutColumns.trim().split(/\s+/).length, viewport.layoutColumns, `card must use ${viewport.layoutColumns} content columns at ${viewport.width}px`);
      assert.equal(geometry.sectionColumns.trim().split(/\s+/).length, viewport.sectionColumns, `card must use ${viewport.sectionColumns} compact section columns at ${viewport.width}px`);
      assert.equal(geometry.listingLinkHidden, false, 'a safe listing URL must expose the header action');
      assert.ok(geometry.coordinatesWidth >= 200, `coordinates must keep a usable row at ${viewport.width}px`);
      geometry.coordinateInputWidths.forEach(width => assert.ok(width >= 60, `coordinate inputs must stay usable at ${viewport.width}px`));
      assert.equal(geometry.coordinateColumnStart, '1');
      assert.equal(geometry.coordinateColumnEnd, '-1', 'coordinates must use one stable full-width identity row');
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    const objectMetrics = await page.locator('#slogi-search-space-card-dialog').evaluate(dialog => ({
      labelStyles: Array.from(dialog.querySelectorAll('.ss-card-row > span, .ss-card-row > legend')).map(label => ({
        fontSize: getComputedStyle(label).fontSize,
        fontWeight: getComputedStyle(label).fontWeight
      })),
      fieldHeights: Array.from(dialog.querySelectorAll('.ss-card-row > input, .ss-card-row > select')).map(field => field.getBoundingClientRect().height),
      choiceGroups: Array.from(dialog.querySelectorAll('.ss-card-option > div')).map(group => ({
        width: group.getBoundingClientRect().width,
        columns: getComputedStyle(group).gridTemplateColumns
      })),
      clusterControlStarts: Array.from(dialog.querySelectorAll('.ss-card-section:first-child .ss-card-row')).map(row => {
        const control = row.querySelector('input:not([type="radio"]), select, .ss-card-option > div');
        return control ? control.getBoundingClientRect().left : null;
      }).filter(value => value !== null)
    }));
    objectMetrics.labelStyles.forEach(style => {
      assert.equal(style.fontSize, '11px', 'object labels must use the same compact typography as workflow labels');
      assert.equal(style.fontWeight, '500');
    });
    objectMetrics.fieldHeights.forEach(height => assert.ok(Math.abs(height - 29) <= 1, 'object fields must match the compact workflow field height'));
    objectMetrics.choiceGroups.forEach(group => {
      assert.ok(Math.abs(group.width - 128) <= 1, 'yes/no controls must have one fixed width');
      assert.equal(group.columns.trim().split(/\s+/).length, 2, 'yes/no controls must use equal columns');
    });
    objectMetrics.clusterControlStarts.forEach(start => assert.ok(Math.abs(start - objectMetrics.clusterControlStarts[0]) <= 1, `controls in a section must start on one vertical line: ${objectMetrics.clusterControlStarts.join(', ')}`));

    const price = page.locator('input[name="pricePerSqm"]');
    await price.focus();
    await price.press('Control+A');
    await price.press('Backspace');
    assert.equal(await price.inputValue(), '', 'an empty price must remain visible while the field is active');
    await price.blur();
    assert.equal(await price.inputValue(), '4000', 'the automatic price must return only after editing ends');

    const comparison = page.locator('input[name="comparisonPercent"]');
    await comparison.focus();
    await comparison.press('Control+A');
    await comparison.press('Backspace');
    await comparison.pressSequentially('-');
    assert.equal(await comparison.inputValue(), '-', 'a leading minus must remain visible while the field is active');
    await comparison.pressSequentially('5');
    assert.equal(await comparison.inputValue(), '-5');
    await comparison.blur();
    assert.equal(await comparison.inputValue(), '-5');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    assert.equal(await page.evaluate(() => window.__savedSpaceCard.competitive.comparisonPercentOverride), -5);
    assert.deepEqual(await page.evaluate(() => ({
      id: window.__savedSpaceCard.id,
      source: window.__savedSpaceCard.source,
      sourceProvider: window.__savedSpaceCard.sourceProvider,
      listingUrl: window.__savedSpaceCard.listingUrl,
      geo: window.__savedSpaceCard.geo,
      centerDetails: window.__savedSpaceCard.cluster.centerDetails,
      rating: window.__savedSpaceCard.competitive.rating,
      rank: window.__savedSpaceCard.competitive.rank,
      work: window.__savedSpaceCard.work
    })), {
      id: 'space-1', source: 'parsed', sourceProvider: 'cian', listingUrl: 'https://example.com/listing',
      geo: { lat: 55.75, lng: 37.61, resolutionSource: 'automatic' }, centerDetails: 'Свободен', rating: 92, rank: 12,
      work: { status: 'draft', marker: 'preserve-me' }
    });

    await comparison.focus();
    await comparison.press('Control+A');
    await comparison.press('Backspace');
    assert.equal(await comparison.inputValue(), '', 'clearing the comparison must not be undone during input');
    await comparison.blur();
    assert.equal(await comparison.inputValue(), '25', 'the calculated comparison must return after the override is cleared');

    const address = page.locator('input[name="address"]');
    await address.fill('');
    await address.pressSequentially('Москва, ');
    assert.equal(await address.inputValue(), 'Москва, ', 'a trailing separator space must survive the input event');
    await address.pressSequentially('улица Академика Королёва, 12');
    assert.equal(await address.inputValue(), 'Москва, улица Академика Королёва, 12');
    await address.blur();
    assert.equal(await address.inputValue(), 'Москва, улица Академика Королёва, 12');

    const takeButton = page.getByRole('button', { name: 'Добавить в «Помещение в работе»' });
    assert.equal(await takeButton.isEnabled(), true, 'specialist CTA must remain enabled even after address invalidates automatic checks');
    await takeButton.click();
    assert.equal(await page.evaluate(() => Boolean(window.__takenSpaceCard)), true);
    assert.equal(await page.evaluate(() => window.__takenEvaluation.canTakeToWork), false, 'eligibility remains diagnostic and does not disable the specialist action');
  } finally {
    await browser.close();
  }
});

test('workflow proposal action stays in the fixed footer and action buttons share one size', { skip: !hasBrowserRuntime }, async () => {
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href);
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<!doctype html><html lang="ru"><body><button id="opener">Открыть</button></body></html>');
    await page.addStyleTag({ path: join(root, 'in-work.css') });
    await page.addStyleTag({ path: join(root, 'search-space-card-modal.css') });
    await page.addScriptTag({ path: join(root, 'search-space-card.js') });
    await page.addScriptTag({ path: join(root, 'search-space-card-modal.js') });
    await page.evaluate(() => {
      window.SlogiSearchSpaceCardModal.open({
        initial: { id: 'space-workflow', source: 'manual', address: 'Москва', work: { status: 'in_work' } },
        opener: document.getElementById('opener'),
        context: 'in-work',
        renderWorkflow() {
          return {
            status: 'Готово к КП',
            html: '<section class="in-work-panel in-work-workflow-panel" data-workflow-panel="contact"><button class="in-work-btn" data-action="save-contact" type="button">Обновить контакт</button></section><section class="in-work-panel in-work-workflow-panel" data-workflow-panel="decision"><button class="in-work-btn danger" data-action="confirm-reject" type="button">Зафиксировать отказ</button></section>',
            historyHtml: '',
            sidebarHtml: '',
            footerAction: { action: 'start-proposal', label: 'Сформировать КП', disabled: false }
          };
        },
        onWorkflowAction(action) { window.__workflowFooterAction = action; return false; }
      });
    });
    await page.getByRole('tab', { name: 'Сопровождение' }).click();
    const proposal = page.getByRole('button', { name: 'Сформировать КП' });
    assert.equal(await proposal.count(), 1, 'the proposal action must exist only once');
    assert.equal(await proposal.locator('xpath=ancestor::footer').count(), 1, 'the proposal action must live in the fixed footer');
    const footerButtons = await page.locator('.ss-card-footer-main .ss-card-button:visible').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, top: node.getBoundingClientRect().top })));
    assert.equal(footerButtons.length, 3);
    footerButtons.forEach(button => {
      assert.ok(Math.abs(button.width - footerButtons[0].width) <= 1);
      assert.ok(Math.abs(button.top - footerButtons[0].top) <= 1);
    });
    const workflowButtons = await page.locator('.ss-card-workflow-content .in-work-btn').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
    workflowButtons.forEach(button => {
      assert.ok(Math.abs(button.width - 170) <= 1);
      assert.ok(Math.abs(button.height - 38) <= 1);
    });
    await proposal.click();
    assert.equal(await page.evaluate(() => window.__workflowFooterAction), 'start-proposal');
    await page.setViewportSize({ width: 375, height: 760 });
    const mobileFooterWidths = await page.locator('.ss-card-footer-main .ss-card-button:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
    assert.equal(mobileFooterWidths.length, 3);
    mobileFooterWidths.forEach(width => assert.ok(Math.abs(width - mobileFooterWidths[0]) <= 1));
  } finally {
    await browser.close();
  }
});

test('proposal unlocks without replacing the canonical card and keeps accompaniment available', { skip: !hasBrowserRuntime }, async () => {
  const { chromium } = await import(pathToFileURL(join(nodeModules, 'playwright', 'index.mjs')).href);
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<!doctype html><html lang="ru"><body><button id="opener">Открыть</button></body></html>');
    await page.addStyleTag({ path: join(root, 'search-space-card-modal.css') });
    await page.addStyleTag({ path: join(root, 'proposal.css') });
    await page.addScriptTag({ path: join(root, 'search-space-card.js') });
    await page.addScriptTag({ path: join(root, 'search-space-card-modal.js') });
    await page.evaluate(() => {
      window.SlogiSearchSpaceCardModal.open({
        initial: { id: 'space-proposal', source: 'manual', address: 'Москва' },
        context: 'in-work',
        renderWorkflow: () => ({ html: '<p>Сопровождение</p>' })
      });
    });
    const beforeTabs = await page.locator('[data-card-tab]').evaluateAll(nodes => nodes.map(node => ({ name: node.textContent.trim(), disabled: node.getAttribute('aria-disabled') })));
    assert.deepEqual(beforeTabs, [
      { name: 'Объект', disabled: 'false' },
      { name: 'Сопровождение', disabled: 'false' },
      { name: 'КП', disabled: 'true' }
    ]);
    const beforeDialog = await page.locator('.ss-card-dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    await page.evaluate(() => {
      window.SlogiSearchSpaceCardModal.close('handoff', true);
      window.SlogiSearchSpaceCardModal.open({
        initial: { id: 'space-proposal', source: 'manual', address: 'Москва' },
        context: 'proposal',
        initialTab: 'proposal',
        renderWorkflow: () => ({ status: 'Передано в КП', html: '<section class="in-work-panel" data-workflow-marker><label class="in-work-field"><span>Контакт</span><input name="workflowDraft"></label><button type="button" data-action="save-contact">Обновить контакт</button></section>' }),
        onWorkflowAction: (action, context) => { window.__proposalWorkflowAction = { action, contact: context.formData.get('workflowDraft') }; return false; },
        renderProposal: () => ({ status: 'Подготовка КП', html: '<div class="proposal-workflow-grid" data-proposal-marker><section class="proposal-panel"><div class="proposal-panel-head"><h3>Коммерческие условия</h3><span class="proposal-status">Черновик</span></div><div class="proposal-terms-grid"><label><span>Ставка</span><input name="proposalDraft"></label></div><div class="proposal-actions"><button class="proposal-btn" type="button">Подготовить КП</button></div></section><section class="proposal-panel"><h3>Пакет</h3></section></div>' }),
        onProposalAction: () => false
      });
    });
    const afterTabs = await page.locator('[data-card-tab]').evaluateAll(nodes => nodes.map(node => ({ name: node.textContent.trim(), disabled: node.getAttribute('aria-disabled'), selected: node.getAttribute('aria-selected') })));
    assert.equal(afterTabs.length, 3);
    assert.deepEqual(afterTabs.map(tab => tab.name), ['Объект', 'Сопровождение', 'КП']);
    assert.equal(afterTabs.find(tab => tab.name === 'Сопровождение').disabled, 'false');
    assert.equal(afterTabs.find(tab => tab.name === 'КП').disabled, 'false');
    assert.equal(afterTabs.find(tab => tab.name === 'КП').selected, 'true');
    assert.equal(await page.locator('[data-proposal-marker]').isVisible(), true);
    assert.equal(await page.locator('[data-header-status]').textContent(), 'Подготовка КП');
    await page.locator('[name="proposalDraft"]').fill('1500');
    const proposalGeometry = await page.evaluate(() => {
      const input = document.querySelector('[name="proposalDraft"]');
      const button = document.querySelector('.ss-card-proposal-content .proposal-btn');
      const status = document.querySelector('.ss-card-proposal-content .proposal-status');
      const columns = getComputedStyle(document.querySelector('.proposal-workflow-grid')).gridTemplateColumns.split(' ').map(parseFloat);
      return {
        inputHeight: input.getBoundingClientRect().height,
        inputFont: getComputedStyle(input).fontSize,
        buttonWidth: button.getBoundingClientRect().width,
        buttonHeight: button.getBoundingClientRect().height,
        buttonFont: getComputedStyle(button).fontSize,
        statusFont: getComputedStyle(status).fontSize,
        columns
      };
    });
    assert.equal(proposalGeometry.inputHeight, 29);
    assert.equal(proposalGeometry.inputFont, '12px');
    assert.deepEqual([proposalGeometry.buttonWidth, proposalGeometry.buttonHeight, proposalGeometry.buttonFont], [170, 38, '13px']);
    assert.equal(proposalGeometry.statusFont, '10px');
    assert.ok(Math.abs(proposalGeometry.columns[0] - proposalGeometry.columns[1]) < 1, 'КП columns must be equal');
    await page.getByRole('tab', { name: 'Сопровождение' }).click();
    assert.equal(await page.locator('[data-workflow-marker]').isVisible(), true);
    assert.equal(await page.locator('[data-header-status]').textContent(), 'Передано в КП');
    await page.locator('[name="workflowDraft"]').fill('Мария');
    await page.getByRole('button', { name: 'Обновить контакт' }).click();
    await page.waitForFunction(() => window.__proposalWorkflowAction && window.__proposalWorkflowAction.action === 'save-contact');
    assert.deepEqual(await page.evaluate(() => window.__proposalWorkflowAction), { action: 'save-contact', contact: 'Мария' });
    await page.getByRole('tab', { name: 'КП' }).click();
    assert.equal(await page.locator('[name="proposalDraft"]').inputValue(), '1500', 'КП draft must survive tab switches');
    await page.getByRole('tab', { name: 'Сопровождение' }).click();
    assert.equal(await page.locator('[name="workflowDraft"]').inputValue(), 'Мария', 'workflow draft must survive tab switches');
    await page.getByRole('tab', { name: 'Объект' }).click();
    await page.locator('[name="rentMonthly"]').fill('250000');
    await page.getByRole('tab', { name: 'КП' }).click();
    assert.equal(await page.locator('[name="proposalDraft"]').inputValue(), '1500', 'КП draft must survive a canonical-card rerender');
    await page.getByRole('tab', { name: 'Сопровождение' }).click();
    assert.equal(await page.locator('[name="workflowDraft"]').inputValue(), 'Мария', 'workflow draft must survive a canonical-card rerender');
    assert.equal(await page.getByRole('tab', { name: 'КП' }).getAttribute('aria-disabled'), 'false');
    await page.getByRole('tab', { name: 'КП' }).click();
    for (const viewport of [
      { width: 1024, height: 800, columns: 2 },
      { width: 681, height: 760, columns: 2 },
      { width: 375, height: 760, columns: 1 },
      { width: 320, height: 700, columns: 1 }
    ]) {
      await page.setViewportSize(viewport);
      const responsive = await page.locator('.ss-card-dialog').evaluate(dialog => ({
        overflow: dialog.scrollWidth - dialog.clientWidth,
        contentOverflow: dialog.querySelector('.ss-card-body').scrollWidth - dialog.querySelector('.ss-card-body').clientWidth,
        columns: getComputedStyle(dialog.querySelector('.proposal-workflow-grid')).gridTemplateColumns.trim().split(/\s+/).length
      }));
      assert.ok(responsive.overflow <= 1, `КП dialog must not overflow at ${viewport.width}px`);
      assert.ok(responsive.contentOverflow <= 1, `КП content must not overflow at ${viewport.width}px`);
      assert.equal(responsive.columns, viewport.columns, `КП must use ${viewport.columns} column(s) at ${viewport.width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const afterDialog = await page.locator('.ss-card-dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    assert.deepEqual(afterDialog, beforeDialog, 'the modal shell must not change when the КП section unlocks');
  } finally {
    await browser.close();
  }
});
