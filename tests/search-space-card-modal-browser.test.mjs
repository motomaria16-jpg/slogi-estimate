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
        }
      });
    });

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
  } finally {
    await browser.close();
  }
});
