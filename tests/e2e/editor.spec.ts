import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';

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
