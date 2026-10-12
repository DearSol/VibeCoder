import { setTimeout as delay } from 'node:timers/promises';
import type { EditRequest } from '../src/ai/providers.ts';

export type ProviderContext = {
  key: string;
  signal: AbortSignal;
  progress: (message: string, taskId?: string) => void;
  fetch: typeof fetch;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  taskId?: string;
};
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
export function imageBytes(value: string) {
  const match = typeof value === 'string' && value.match(DATA_IMAGE);
  if (!match || value.length > 8_000_000)
    throw new Error('An input image is invalid or too large.');
  return { mime: `image/${match[1]}`, bytes: Buffer.from(match[2], 'base64'), data: match[2] };
}
export function validateEdit(value: unknown): EditRequest {
  const input = value as EditRequest;
  if (!input || !['openai', 'google', 'openrouter', 'kie'].includes(input.provider))
    throw new Error('Choose a supported provider.');
  if (typeof input.model !== 'string' || !/^[a-zA-Z0-9][\w./:-]{0,149}$/.test(input.model))
    throw new Error('Enter a valid image-editing model ID.');
  if (input.provider === 'kie' && input.model !== 'nano-banana-pro')
    throw new Error('This Kie adapter currently supports nano-banana-pro only.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000)
    throw new Error('Enter a prompt of up to 8,000 characters.');
  if (!Array.isArray(input.references) || input.references.length > 4)
    throw new Error('Use up to four reference images.');
  for (const ref of input.references) {
    if (!ref || typeof ref.name !== 'string' || ref.name.length > 200)
      throw new Error('Invalid reference metadata.');
    imageBytes(ref.image);
  }
  for (const image of [input.image, input.mask, input.guide]) imageBytes(image);
  return input;
}

// Never include raw provider responses, request headers, or credentials in errors.
async function json(context: ProviderContext, url: string, init: RequestInit = {}) {
  const response = await context.fetch(url, { ...init, signal: context.signal, redirect: 'error' });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'The provider rejected the model or image settings. Check the model supports image editing.',
      401: 'The provider rejected this API key.',
      403: 'The provider denied access. Check model access and account permissions.',
      404: 'The provider could not find this model or endpoint.',
      429: 'The provider limit was reached. Check credits and rate limits before trying again.',
    };
    throw new Error(messages[response.status] || `The provider returned HTTP ${response.status}.`);
  }
  const text = await limitedText(response, 32_000_000);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The provider returned an unreadable response.');
  }
}
async function limitedText(response: Response, maximum: number) {
  if (!response.body) throw new Error('The provider returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('The provider response exceeded the supported size.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
function generatedImage(value: unknown) {
  if (typeof value !== 'string' || !DATA_IMAGE.test(value) || value.length > 28_000_000)
    throw new Error(
      'The provider did not return a supported image. Check the model has image output.',
    );
  return value;
}
function prompt(input: EditRequest) {
  return `Edit the FIRST image. Return one square image with exactly the same framing and geometry. Do not crop, rotate, or move unchanged objects. The SECOND image is a black-and-white selection guide: edit WHITE areas only, preserve BLACK areas. Do not render this guide in the result. Subsequent images are references, in the order listed below. Use them only to guide the requested edit, not as the output canvas.\nReferences: ${input.references.map((ref, i) => `${i + 1}: ${ref.name}`).join('; ') || 'none'}.\nRequested edit: ${input.prompt}`;
}
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export async function generate(input: EditRequest, context: ProviderContext): Promise<string> {
  const { key } = context;
  if (input.provider === 'openai') {
    const form = new FormData();
    form.set('model', input.model);
    form.set(
      'prompt',
      `Edit the first image only within the transparent mask. Preserve framing and geometry. Additional images are references in this order: ${input.references.map((ref) => ref.name).join(', ') || 'none'}. Return the edited first image. ${input.prompt}`,
    );
    form.set('n', '1');
    form.set('size', '1024x1024');
    form.set('quality', 'medium');
    form.set('output_format', 'png');
    for (const [i, value] of [input.image, ...input.references.map((ref) => ref.image)].entries()) {
      const image = imageBytes(value);
      form.append('image[]', new Blob([image.bytes], { type: image.mime }), `image-${i}.png`);
    }
    const mask = imageBytes(input.mask);
    form.set('mask', new Blob([mask.bytes], { type: mask.mime }), 'mask.png');
    context.progress('Generating with OpenAI…');
    const result = await json(context, 'https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: bearer(key),
      body: form,
    });
    return generatedImage(`data:image/png;base64,${result.data?.[0]?.b64_json || ''}`);
  }
  const images = [input.image, input.guide, ...input.references.map((ref) => ref.image)];
  if (input.provider === 'google') {
    context.progress('Generating with Google Gemini…');
    const result = await json(
      context,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt(input) },
                ...images.map((value) => {
                  const image = imageBytes(value);
                  return { inlineData: { mimeType: image.mime, data: image.data } };
                }),
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '1:1' },
          },
        }),
      },
    );
    const image = result.candidates?.[0]?.content?.parts?.find(
      (part: { inlineData?: unknown; thought?: boolean }) => part.inlineData && !part.thought,
    )?.inlineData;
    return generatedImage(image ? `data:${image.mimeType};base64,${image.data}` : '');
  }
  if (input.provider === 'openrouter') {
    context.progress('Generating with OpenRouter…');
    const result = await json(context, 'https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { ...bearer(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '1:1' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt(input) },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          },
        ],
      }),
    });
    return generatedImage(result.choices?.[0]?.message?.images?.[0]?.image_url?.url);
  }

  let taskId = context.taskId;
  if (!taskId) {
    const urls: string[] = [];
    for (const [index, image] of images.entries()) {
      context.progress(`Uploading Kie input ${index + 1} of ${images.length}…`);
      const uploaded = await json(context, 'https://kieai.redpandaai.co/api/file-base64-upload', {
        method: 'POST',
        headers: { ...bearer(key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Data: image,
          uploadPath: 'expand-studio',
          fileName: `${crypto.randomUUID()}.png`,
        }),
      });
      const url = uploaded.data?.downloadUrl;
      if (uploaded.code !== 200 || typeof url !== 'string' || !url.startsWith('https://'))
        throw new Error(
          'Kie could not upload an input image. Check your key and the upload service.',
        );
      urls.push(url);
    }
    context.progress('Submitting Kie generation…');
    const result = await json(context, 'https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { ...bearer(key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        input: {
          prompt: prompt(input),
          image_input: urls,
          aspect_ratio: '1:1',
          resolution: '1K',
          output_format: 'png',
        },
      }),
    });
    taskId = result.data?.taskId;
    if (result.code !== 200 || typeof taskId !== 'string' || !/^[\w-]{1,200}$/.test(taskId))
      throw new Error(
        'Kie did not confirm a task ID. Check your Kie dashboard before submitting again.',
      );
  }
  context.progress('Waiting for Kie generation…', taskId);
  const wait = context.wait || ((ms, signal) => delay(ms, undefined, { signal }));
  while (true) {
    context.signal.throwIfAborted();
    const result = await json(
      context,
      `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      { headers: bearer(key) },
    );
    if (result.code !== 200)
      throw new Error(
        'Kie task status could not be read. The task ID is retained for checking again.',
      );
    if (result.data?.state === 'fail')
      throw new Error('Kie generation failed. Check task details in your Kie dashboard.');
    if (result.data?.state === 'success') {
      let urls;
      try {
        urls = JSON.parse(result.data.resultJson).resultUrls;
      } catch {
        throw new Error('Kie returned invalid result metadata.');
      }
      const url = new URL(urls?.[0]);
      // Download only Kie asset hosts, without sending the API key. No arbitrary URL proxy.
      if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        !['tempfile.aiquickdraw.com', 'tempfile.redpandaai.co'].includes(url.hostname)
      )
        throw new Error(
          'Kie returned an unrecognized image host. Check the task in your Kie dashboard.',
        );
      const response = await context.fetch(url, { signal: context.signal, redirect: 'error' });
      if (!response.ok) throw new Error('The Kie result image could not be downloaded.');
      const mime = response.headers.get('content-type')?.split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime || ''))
        throw new Error('Kie returned an unsupported image format.');
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 20_000_000) throw new Error('The generated image is too large.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return generatedImage(`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`);
    }
    await wait(2000, context.signal);
  }
}
