import { poissonBlend } from '../model/poisson';
import type { PixelImage } from '../model/pixels';

self.onmessage = (
  event: MessageEvent<{
    image: PixelImage;
    mask: Uint8ClampedArray;
    dx: number;
    dy: number;
    source?: PixelImage;
  }>,
) => {
  try {
    const { image, mask, dx, dy, source } = event.data;
    const result = poissonBlend(image, mask, dx, dy, {
      source,
      progress: (iteration, max) => self.postMessage({ type: 'progress', iteration, max }),
    });
    self.postMessage({ type: 'result', result }, { transfer: [result.data.buffer] });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Blending failed.',
    });
  }
};
