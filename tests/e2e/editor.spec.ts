import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

function fixture() {
  const png = new PNG({ width: 64, height: 48 });
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      const defect = x >= 16 && x < 24 && y >= 16 && y < 24;
      const sample = x >= 30 && x < 46 && y >= 8 && y < 40;
      const color = defect
        ? [10, 10, 10, 255]
        : sample
          ? [190, 180, 170, 255]
          : [80, 130, 100, 255];
      png.data.set(color, (y * 64 + x) * 4);
    }
  return { png, bytes: PNG.sync.write(png) };
}
async function point(page: Page, x: number, y: number) {
  const surface = page.getByTestId('editor-canvas');
  const rect = (await surface.boundingBox())!;
  const scale = Number(await surface.getAttribute('data-scale'));
  return {
    x: rect.x + Number(await surface.getAttribute('data-image-left')) + x * scale,
    y: rect.y + Number(await surface.getAttribute('data-image-top')) + y * scale,
  };
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const start = await point(page, ...from),
    end = await point(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}
async function exportPng(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloading;
  return PNG.sync.read(await readFile((await download.path())!));
}

test('Poisson repair preserves protected pixels, supports history, and survives project reopening', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const source = fixture();
  await page.goto('/');
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'Repair test.png', mimeType: 'image/png', buffer: source.bytes });
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  await drag(page, [16, 16], [24, 24]);
  await expect(page.getByText('8 × 8 px', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Local patch', exact: true }).click();
  await drag(page, [20, 20], [36, 20]);
  await expect(page.getByText('16, 0 px', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Blend & apply repair' }).click();
  await expect(page.getByLabel('Layer name: Poisson repair 1', { exact: true })).toBeVisible();
  const repaired = await exportPng(page);
  expect([repaired.width, repaired.height]).toEqual([64, 48]);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      const index = (y * 64 + x) * 4;
      const expected =
        x >= 16 && x < 24 && y >= 16 && y < 24
          ? [80, 130, 100, 255]
          : [...source.png.data.subarray(index, index + 4)];
      expect([...repaired.data.subarray(index, index + 4)], `pixel ${x},${y}`).toEqual(expected);
    }
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  expect((await exportPng(page)).data).toEqual(source.png.data);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  expect((await exportPng(page)).data).toEqual(repaired.data);
  await page.getByRole('button', { name: 'Hide Poisson repair 1', exact: true }).click();
  expect((await exportPng(page)).data).toEqual(source.png.data);
  await page.getByRole('button', { name: 'Show Poisson repair 1', exact: true }).click();

  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const project = await saving;
  const projectBytes = await readFile((await project.path())!);
  expect(project.suggestedFilename()).toBe('Repair test.expand');
  await page.getByLabel('Open image or project', { exact: true }).setInputFiles({
    name: 'Repair test.expand',
    mimeType: 'application/zip',
    buffer: projectBytes,
  });
  await expect(page.getByText('Project restored. All image assets are included.')).toBeVisible();
  await expect(page.getByLabel('Layer name: Poisson repair 1', { exact: true })).toBeVisible();
  expect((await exportPng(page)).data).toEqual(repaired.data);

  await page.getByLabel('Open image or project', { exact: true }).setInputFiles({
    name: 'Damaged.expand',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a project'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Layer name: Poisson repair 1', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('brush subtraction protects a hole and selection coordinates survive zoom', async ({
  page,
}) => {
  const source = fixture();
  await page.goto('/');
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'Mask test.png', mimeType: 'image/png', buffer: source.bytes });
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await drag(page, [16, 16], [24, 24]);
  await page.getByRole('button', { name: 'Selection brush', exact: true }).click();
  await page.getByLabel('Brush size', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Subtract selection', exact: true }).click();
  const hole = await point(page, 20, 20);
  await page.mouse.click(hole.x, hole.y);
  await page.getByRole('button', { name: 'Local patch', exact: true }).click();
  await page.getByLabel('Seam blending', { exact: true }).selectOption('feather');
  await drag(page, [17, 17], [33, 17]);
  await page.getByRole('button', { name: 'Apply repair', exact: true }).click();
  const result = await exportPng(page);
  expect([...result.data.subarray((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)]).toEqual([
    10, 10, 10, 255,
  ]);
  expect([...result.data.subarray((17 * 64 + 17) * 4, (17 * 64 + 17) * 4 + 4)]).toEqual([
    190, 180, 170, 255,
  ]);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++)
      if (x < 16 || x >= 24 || y < 16 || y >= 24) {
        const index = (y * 64 + x) * 4;
        expect(result.data.subarray(index, index + 4), `protected ${x},${y}`).toEqual(
          source.png.data.subarray(index, index + 4),
        );
      }
});

test('the sample workspace loads without external image dependencies', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your image. A new perspective.' })).toBeVisible();
  await page.getByRole('button', { name: /explore with a sample/ }).click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-document-width', '1600');
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-document-height', '1100');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
});

async function simulateAi(page: Page, captured: object[], configured = false) {
  const result = new PNG({ width: 1024, height: 1024 });
  for (let i = 0; i < 1024 * 1024; i++) result.data.set([210, 60, 40, 255], i * 4);
  const image = `data:image/png;base64,${PNG.sync.write(result).toString('base64')}`;
  const keys = { openai: configured, google: configured, openrouter: configured, kie: configured };
  await page.route('**/api/ai/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session'))
      return route.fulfill({ json: { token: 'simulation-session', configured: keys } });
    if (path.endsWith('/credentials')) {
      const data = route.request().postDataJSON();
      keys[data.provider as keyof typeof keys] = !!data.key;
      return route.fulfill({ json: { configured: keys } });
    }
    if (path.endsWith('/jobs')) {
      captured.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        json: { id: 'simulated-job', state: 'running', message: 'Simulated provider request' },
      });
    }
    return route.fulfill({
      json: { id: 'simulated-job', state: 'completed', message: 'Ready to review.', image },
    });
  });
}

test('AI Fill reviews a simulated result, protects pixels, and saves references without credentials', async ({
  page,
}) => {
  const requests: object[] = [];
  await simulateAi(page, requests);
  const source = fixture();
  await page.goto('/');
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'AI test.png', mimeType: 'image/png', buffer: source.bytes });
  await drag(page, [16, 16], [24, 24]);
  await page.getByText('API key · needed', { exact: true }).click();
  await page.getByLabel('OpenAI API key', { exact: true }).fill('fake-key-for-simulation-only');
  await page.getByRole('button', { name: 'Use key', exact: true }).click();
  await expect(page.getByText('API key · configured', { exact: true })).toBeVisible();
  await page.getByLabel('Provider', { exact: true }).selectOption('google');
  await expect(page.getByText('API key · needed', { exact: true })).toBeVisible();
  await page.getByLabel('Provider', { exact: true }).selectOption('openai');
  await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveValue('');
  await page
    .getByLabel('Describe your edit', { exact: true })
    .fill('Replace the selected defect with a red object from the references');
  await page.getByLabel(/Reference images/).setInputFiles([
    { name: 'Reference A.png', mimeType: 'image/png', buffer: source.bytes },
    { name: 'Reference B.png', mimeType: 'image/png', buffer: source.bytes },
  ]);
  await expect(page.getByAltText('Reference 2: Reference B.png')).toBeVisible();
  await page.getByRole('button', { name: 'Generate edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review generated edit' })).toBeVisible();
  expect(requests).toHaveLength(1);
  const input = requests[0] as { references: object[]; mask: string; guide: string };
  expect(input.references).toHaveLength(2);
  const mask = PNG.sync.read(Buffer.from(input.mask.split(',')[1], 'base64'));
  expect(mask.data[(320 * 1024 + 320) * 4 + 3]).toBe(0);
  expect(mask.data[(64 * 1024 + 64) * 4 + 3]).toBe(255);
  await page.getByRole('button', { name: 'Accept edit', exact: true }).click();
  const output = await exportPng(page);
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const expected =
        x >= 16 && x < 24 && y >= 16 && y < 24
          ? [210, 60, 40, 255]
          : [...source.png.data.subarray(i, i + 4)];
      expect([...output.data.subarray(i, i + 4)], `AI protected pixel ${x},${y}`).toEqual(expected);
    }
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const bytes = await readFile((await (await saving).path())!);
  const files = unzipSync(bytes),
    manifestText = strFromU8(files['manifest.json']);
  expect(manifestText).not.toContain('fake-key-for-simulation-only');
  const manifest = JSON.parse(manifestText);
  expect(manifest.layers[1].generation.references).toHaveLength(2);
  expect(files['assets/reference-1-0.png']).toBeDefined();
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'AI test.expand', mimeType: 'application/zip', buffer: bytes });
  await expect(page.getByLabel('Layer name: AI edit 1', { exact: true })).toBeVisible();
  expect((await exportPng(page)).data).toEqual(output.data);
});

test('expansion handles preview bounds without submitting and accepted expansion preserves every original pixel', async ({
  page,
}) => {
  const requests: object[] = [];
  await simulateAi(page, requests, true);
  const source = fixture();
  await page.goto('/');
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'Expand test.png', mimeType: 'image/png', buffer: source.bytes });
  await page.getByRole('button', { name: 'Generative Expand', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Expand right handle', exact: true });
  const box = (await handle.boundingBox())!,
    scale = Number(await page.getByTestId('editor-canvas').getAttribute('data-scale'));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8 * scale, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel('Right expansion pixels', { exact: true })).toHaveValue('8');
  expect(requests).toHaveLength(0);
  const canvas = page.getByTestId('editor-canvas');
  const originalScreenX = Number(await canvas.getAttribute('data-image-left'));
  const originalScreenY = Number(await canvas.getAttribute('data-image-top'));
  const corner = (await page
    .getByRole('button', { name: 'Expand top-left handle', exact: true })
    .boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    corner.x + corner.width / 2 - 5 * scale,
    corner.y + corner.height / 2 - 3 * scale,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByLabel('Left expansion pixels', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Top expansion pixels', { exact: true })).toHaveValue('3');
  expect(Number(await canvas.getAttribute('data-image-left')) + 5 * scale).toBeCloseTo(
    originalScreenX,
    4,
  );
  expect(Number(await canvas.getAttribute('data-image-top')) + 3 * scale).toBeCloseTo(
    originalScreenY,
    4,
  );
  await page.getByLabel('Left expansion pixels', { exact: true }).fill('12');
  await page.getByLabel('Right expansion pixels', { exact: true }).fill('4');
  await page.getByLabel('Top expansion pixels', { exact: true }).fill('8');
  await page.getByLabel('Bottom expansion pixels', { exact: true }).fill('6');
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-document-width', '80');
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-document-height', '62');
  await page.getByRole('button', { name: 'Generate expansion', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review generated edit' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept edit', exact: true }).click();
  const expanded = await exportPng(page);
  expect([expanded.width, expanded.height]).toEqual([80, 62]);
  for (let y = 0; y < 62; y++)
    for (let x = 0; x < 80; x++) {
      const original = x >= 12 && x < 76 && y >= 8 && y < 56;
      const i = (y * 80 + x) * 4,
        sourceIndex = ((y - 8) * 64 + x - 12) * 4;
      expect([...expanded.data.subarray(i, i + 4)], `expand pixel ${x},${y}`).toEqual(
        original ? [...source.png.data.subarray(sourceIndex, sourceIndex + 4)] : [210, 60, 40, 255],
      );
    }
  await page.getByRole('button', { name: 'Hide Expansion 1', exact: true }).click();
  const hidden = await exportPng(page);
  expect([hidden.width, hidden.height]).toEqual([80, 62]);
  expect(hidden.data[3]).toBe(0);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  expect((await exportPng(page)).data).toEqual(source.png.data);
  expect(requests).toHaveLength(1);
});

test('editing modes, grouped lassos and marquee, and larger text are visible and functional', async ({
  page,
}) => {
  const source = fixture();
  await page.goto('/');
  for (const mode of ['Generative Fill', 'Remove', 'Generative Expand', 'Local Repair'])
    await expect(page.getByRole('button', { name: mode, exact: true })).toBeVisible();
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'Tools test.png', mimeType: 'image/png', buffer: source.bytes });
  await page.getByRole('button', { name: 'Lasso tools', exact: true }).click();
  for (const name of ['Freehand lasso', 'Polygonal lasso', 'Magnetic lasso'])
    await expect(
      page
        .getByRole('group', { name: 'Lasso tools choices' })
        .getByRole('button', { name: new RegExp(name) }),
    ).toBeVisible();
  await page
    .getByRole('group', { name: 'Lasso tools choices' })
    .getByRole('button', { name: /Polygonal lasso/ })
    .click();
  for (const [x, y] of [
    [16, 16],
    [24, 16],
    [24, 24],
    [16, 24],
  ]) {
    const p = await point(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('8 × 8 px', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Marquee tools', exact: true }).click();
  await page.getByRole('button', { name: /Elliptical marquee/ }).click();
  await drag(page, [16, 16], [24, 24]);
  await page.getByLabel('Interface text size', { exact: true }).selectOption('1.3');
  const button = page.getByRole('button', { name: 'Generative Fill', exact: true });
  expect(
    await button.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(18);
  await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeVisible();
  await expect(page.getByLabel('Layer name: Original image', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/readable-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Generative Expand', exact: true }).click();
  await page.getByLabel('Left expansion pixels', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Selection brush', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generative Fill', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-document-width', '64');
});

test('Remove generates with no prompt, while stopping a simulated job leaves the document unchanged', async ({
  page,
}) => {
  const requests: object[] = [];
  await simulateAi(page, requests, true);
  const source = fixture();
  await page.goto('/');
  await page
    .getByLabel('Open image or project', { exact: true })
    .setInputFiles({ name: 'Remove test.png', mimeType: 'image/png', buffer: source.bytes });
  await drag(page, [16, 16], [24, 24]);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Generate removal', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review generated edit' })).toBeVisible();
  expect((requests[0] as { prompt: string }).prompt).toContain(
    'reconstruct the surrounding background',
  );
  await page.getByRole('button', { name: 'Discard result', exact: true }).click();
  expect((await exportPng(page)).data).toEqual(source.png.data);
  await page.route('**/api/ai/jobs/*', async (route) =>
    route.fulfill({
      json: {
        id: 'simulated-job',
        state: route.request().method() === 'DELETE' ? 'stopped' : 'running',
        message: 'Waiting on simulated provider',
      },
    }),
  );
  await page.getByRole('button', { name: 'Generate removal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop local waiting', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop local waiting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop local waiting', exact: true })).toHaveCount(
    0,
  );
  expect((await exportPng(page)).data).toEqual(source.png.data);
  await expect(page.getByRole('dialog', { name: 'Review generated edit' })).toHaveCount(0);
});
