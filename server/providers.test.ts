import { describe, expect, it, vi } from 'vitest';
import { generate, validateEdit, type ProviderContext } from './providers';
import type { EditRequest } from '../src/ai/providers';

const image = 'data:image/png;base64,aW1hZ2U=';
const input: EditRequest = {
  provider: 'openai',
  model: 'gpt-image-1.5',
  prompt: 'Replace the selected object',
  image,
  mask: image,
  guide: image,
  references: [
    { name: 'Reference A', image },
    { name: 'Reference B', image },
  ],
};
function setup(responses: unknown[]) {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(responses.shift()), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const progress = vi.fn();
  const context: ProviderContext = {
    key: 'test-only-key',
    signal: new AbortController().signal,
    fetch: fetcher,
    progress,
    wait: async () => {},
  };
  return { context, fetcher, progress };
}
describe('provider adapters with simulated responses (no live AI calls)', () => {
  it('sends OpenAI the first image, native mask, and every reference in order', async () => {
    const { context, fetcher } = setup([{ data: [{ b64_json: 'aW1hZ2U=' }] }]);
    expect(await generate(input, context)).toBe(image);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    const form = options!.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(3);
    expect(form.get('mask')).toBeInstanceOf(Blob);
    expect(form.get('model')).toBe(input.model);
    expect(form.get('size')).toBe('1024x1024');
  });
  it('sends Google labeled edit instructions, mask guide, and references with image output enabled', async () => {
    const { context, fetcher } = setup([
      {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Done' },
                { thought: true, inlineData: { mimeType: 'image/png', data: 'dGhvdWdodA==' } },
                { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
              ],
            },
          },
        ],
      },
    ]);
    expect(
      await generate({ ...input, provider: 'google', model: 'gemini-2.5-flash-image' }, context),
    ).toBe(image);
    const options = fetcher.mock.calls[0][1]!;
    expect(options.headers).toHaveProperty('x-goog-api-key', context.key);
    const body = JSON.parse(options.body as string);
    expect(body.contents[0].parts).toHaveLength(5);
    expect(body.generationConfig.responseModalities).toContain('IMAGE');
  });
  it('sends OpenRouter multimodal content and reads the returned image', async () => {
    const { context, fetcher } = setup([
      { choices: [{ message: { images: [{ image_url: { url: image } }] } }] },
    ]);
    expect(await generate({ ...input, provider: 'openrouter' }, context)).toBe(image);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.modalities).toEqual(['image', 'text']);
    expect(
      body.messages[0].content.filter((part: { type: string }) => part.type === 'image_url'),
    ).toHaveLength(4);
  });
  it('rejects text-only responses instead of accepting them as images', async () => {
    const { context } = setup([
      { choices: [{ message: { content: 'I cannot generate images' } }] },
    ]);
    await expect(generate({ ...input, provider: 'openrouter' }, context)).rejects.toThrow(
      'image output',
    );
  });
  it('reports authentication errors without echoing provider bodies or retrying', async () => {
    const { context, fetcher } = setup([]);
    fetcher.mockResolvedValue(
      new Response('test-only-key sensitive provider text', { status: 401 }),
    );
    await expect(generate(input, context)).rejects.toThrow('rejected this API key');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uploads Kie inputs once, polls one task, and downloads without authorization headers', async () => {
    const { context, fetcher, progress } = setup([
      ...Array.from({ length: 4 }, (_, i) => ({
        code: 200,
        data: { downloadUrl: `https://tempfile.aiquickdraw.com/input-${i}.png` },
      })),
      { code: 200, data: { taskId: 'task-123' } },
      { code: 200, data: { state: 'generating' } },
      {
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({
            resultUrls: ['https://tempfile.aiquickdraw.com/result.png'],
          }),
        },
      },
    ]);
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) =>
      String(args[0]).includes('/result.png')
        ? new Response(Buffer.from('image'), { headers: { 'Content-Type': 'image/png' } })
        : original(...args),
    );
    expect(await generate({ ...input, provider: 'kie', model: 'nano-banana-pro' }, context)).toBe(
      image,
    );
    expect(progress).toHaveBeenCalledWith('Waiting for Kie generation…', 'task-123');
    const create = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/createTask'));
    expect(create).toHaveLength(1);
    expect(JSON.parse(create[0][1]!.body as string).input.image_input).toHaveLength(4);
    expect(fetcher.mock.calls.at(-1)![1]!.headers).toBeUndefined();
  });
  it('resumes Kie polling without uploading or submitting a new paid task', async () => {
    const { context, fetcher } = setup([{ code: 200, data: { state: 'fail' } }]);
    await expect(
      generate(
        { ...input, provider: 'kie', model: 'nano-banana-pro' },
        { ...context, taskId: 'existing-task' },
      ),
    ).rejects.toThrow('generation failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('recordInfo?taskId=existing-task');
  });
  it('rejects arbitrary Kie result download destinations', async () => {
    const { context, fetcher } = setup([
      {
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['http://127.0.0.1/secret'] }),
        },
      },
    ]);
    await expect(
      generate({ ...input, provider: 'kie' }, { ...context, taskId: 'task' }),
    ).rejects.toThrow('unrecognized image host');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('stops Kie polling when cancelled', async () => {
    const { context, fetcher } = setup([{ code: 200, data: { state: 'generating' } }]);
    const controller = new AbortController();
    await expect(
      generate(
        { ...input, provider: 'kie' },
        {
          ...context,
          taskId: 'task',
          signal: controller.signal,
          wait: async () => {
            controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('validates model schemas and rejects unsupported references before submission', () => {
    expect(() => validateEdit({ ...input, provider: 'kie', model: 'unimplemented-model' })).toThrow(
      'nano-banana-pro',
    );
    expect(() =>
      validateEdit({ ...input, references: Array(5).fill(input.references[0]) }),
    ).toThrow('four');
    expect(() => validateEdit({ ...input, image: 'https://external/image.png' })).toThrow(
      'invalid',
    );
  });
});
