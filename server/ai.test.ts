import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiService } from './ai';

const resources: { server: Server; close: () => void }[] = [];
afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async ({ server, close }) => {
      close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});
async function setup(env = {}) {
  const transport = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] })),
  );
  const service = createAiService(env, transport);
  const server = createServer((req, res) => {
    void service.handle(req, res, () => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  resources.push({ server, close: service.close });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ai/`;
  const session = await (await fetch(base + 'session')).json();
  const headers = { 'Content-Type': 'application/json', 'X-Expand-Token': session.token };
  return { base, session, headers, transport };
}
describe('local AI service', () => {
  it('reports configured status without returning keys', async () => {
    const { session } = await setup({ EXPAND_OPENAI_API_KEY: 'server-secret' });
    expect(session.configured.openai).toBe(true);
    expect(JSON.stringify(session)).not.toContain('server-secret');
  });
  it('blocks foreign origins, missing session tokens, and hostile Host headers', async () => {
    const { base, headers } = await setup();
    const payload = JSON.stringify({ provider: 'openai', key: 'test-key' });
    expect(
      (
        await fetch(base + 'credentials', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://foreign.example' },
          body: payload,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(base + 'credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
      ).status,
    ).toBe(403);
    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      request(base + 'session', { headers: { Host: 'foreign.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode!);
      })
        .on('error', reject)
        .end();
    });
    expect(hostileHostStatus).toBe(403);
  });
  it('keeps provider keys separate, submits a job, and forgets the session key', async () => {
    const { base, headers, transport } = await setup();
    const saved = await (
      await fetch(base + 'credentials', {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'openai', key: 'test-openai-key' }),
      })
    ).json();
    expect(saved.configured.openai).toBe(true);
    expect(saved.configured.google).toBe(false);
    const image = 'data:image/png;base64,aW1hZ2U=';
    const response = await fetch(base + 'jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-image-1.5',
        prompt: 'Edit',
        image,
        mask: image,
        guide: image,
        references: [],
      }),
    });
    expect(response.status).toBe(202);
    const job = await response.json();
    await vi.waitFor(async () => {
      const result = await (await fetch(base + `jobs/${job.id}`, { headers })).json();
      expect(result.state).toBe('completed');
      expect(result.image).toBe(image);
      expect(JSON.stringify(result)).not.toContain('test-openai-key');
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const forgotten = await (
      await fetch(base + 'credentials', {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: 'openai', key: '' }),
      })
    ).json();
    expect(forgotten.configured.openai).toBe(false);
  });
});
