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
          address: 'Москва',
          cluster: { name: 'Лефортово', status: 'inside', hasSlogiCenter: false },
          competitive: { rank: 12, averageRentPerSqm: 3200 },
          rentMonthly: 480000,
          area: 120,
          areaConfirmed: true,
          separateEntrance: true,
          hasWindows: true,
          windowsOpen: true,
          ceilingHeight: 3.4,
          ceilingHeightConfirmed: true,
          repair: 'finished'
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
      { width: 1280, height: 900, columns: 3 },
      { width: 1024, height: 800, columns: 2 },
      { width: 981, height: 800, columns: 2 },
      { width: 681, height: 760, columns: 1 },
      { width: 375, height: 760, columns: 1 },
      { width: 320, height: 700, columns: 1 }
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.locator('#slogi-search-space-card-dialog').evaluate(dialog => ({
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        bodyOverflow: dialog.querySelector('.ss-card-body').scrollWidth - dialog.querySelector('.ss-card-body').clientWidth,
        columns: getComputedStyle(dialog.querySelector('.ss-card-columns')).gridTemplateColumns,
        coordinatesWidth: dialog.querySelector('.ss-card-coordinates').getBoundingClientRect().width,
        coordinateInputWidths: Array.from(dialog.querySelectorAll('.ss-card-coordinate-inputs input'), input => input.getBoundingClientRect().width),
        coordinateColumnStart: getComputedStyle(dialog.querySelector('.ss-card-coordinates')).gridColumnStart,
        coordinateColumnEnd: getComputedStyle(dialog.querySelector('.ss-card-coordinates')).gridColumnEnd,
        listingLinkHidden: dialog.querySelector('[data-listing-field-link]').hidden
      }));
      assert.ok(geometry.dialogOverflow <= 1, `dialog must not overflow at ${viewport.width}px`);
      assert.ok(geometry.bodyOverflow <= 1, `body must not overflow at ${viewport.width}px`);
      assert.equal(geometry.columns.trim().split(/\s+/).length, viewport.columns, `card must use ${viewport.columns} section columns at ${viewport.width}px`);
      assert.equal(geometry.listingLinkHidden, true, 'the no-URL card must keep the listing action hidden');
      assert.ok(geometry.coordinatesWidth >= 200, `coordinates must keep a usable row at ${viewport.width}px`);
      geometry.coordinateInputWidths.forEach(width => assert.ok(width >= 60, `coordinate inputs must stay usable at ${viewport.width}px`));
      if (viewport.width > 1080) assert.equal(geometry.coordinateColumnStart, '5', 'desktop coordinates must stay in the final wide identity column');
      else {
        assert.equal(geometry.coordinateColumnStart, '1');
        assert.equal(geometry.coordinateColumnEnd, '-1', 'intermediate and mobile coordinates must span the identity row');
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });

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
