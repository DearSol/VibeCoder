import type { PixelImage } from './pixels';
import type { PoissonResult } from './poisson';

export function blendInWorker(
  image: PixelImage,
  mask: Uint8ClampedArray,
  dx: number,
  dy: number,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<PoissonResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/poisson.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Blending cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        progress(`Blending seam · iteration ${data.iteration.toLocaleString()}`);
        return;
      }
      finish();
      if (data.type === 'result') resolve(data.result);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('The blending worker could not run. Try again or use Feather.'));
    };
    worker.postMessage({ image, mask, dx, dy });
  });
}
