import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { providers, type EditRequest, type JobView, type ProviderId } from '../src/ai/providers.ts';
import { generate, validateEdit } from './providers.ts';

type Job = JobView & { input: EditRequest; controller: AbortController; created: number };
export function createAiService(env: Record<string, string | undefined>, transport = fetch) {
  const token = randomUUID();
  const keys = new Map<ProviderId, string>();
  const jobs = new Map<string, Job>();
  const configured = () =>
    Object.fromEntries(
      Object.entries(providers).map(([id, info]) => [
        id,
        !!(keys.get(id as ProviderId) || env[info.env]),
      ]),
    );
  const publicJob = (job: Job): JobView => ({
    id: job.id,
    state: job.state,
    message: job.message,
    taskId: job.taskId,
    image: job.image,
  });
  const respond = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  };
  async function body(request: IncomingMessage) {
    if (!request.headers['content-type']?.startsWith('application/json'))
      throw new Error('Expected JSON input.');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 40_000_000)
        throw new Error('The request is too large. Use smaller reference images.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('Invalid JSON input.');
    }
  }
  function start(job: Job, key: string) {
    const controller = new AbortController();
    job.controller = controller;
    job.state = 'running';
    job.message = job.taskId ? 'Checking existing Kie task…' : 'Preparing generation…';
    const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
    timeout.unref();
    void generate(job.input, {
      key,
      signal: controller.signal,
      taskId: job.taskId,
      fetch: transport,
      progress: (message, taskId) => {
        if (job.controller !== controller || controller.signal.aborted) return;
        job.message = message;
        if (taskId) job.taskId = taskId;
      },
    })
      .then((image) => {
        if (controller.signal.aborted || job.controller !== controller) return;
        job.image = image;
        job.state = 'completed';
        job.message = 'Ready to review.';
      })
      .catch((error) => {
        if (job.controller !== controller) return;
        if (controller.signal.aborted) {
          job.state = 'stopped';
          job.message =
            'Local waiting stopped. The provider may continue and charge for this request.';
        } else {
          job.state = 'failed';
          // Provider errors above are curated; fetch errors are deliberately not returned.
          job.message =
            error instanceof TypeError
              ? 'The provider connection failed. Check your network and provider dashboard before trying again.'
              : String(error.message || 'Generation failed.');
          if (key) job.message = job.message.split(key).join('[redacted]');
        }
      })
      .finally(() => clearTimeout(timeout));
  }
  const cleanup = setInterval(() => {
    for (const [id, job] of jobs) {
      if (job.state !== 'running' && Date.now() - job.created > 30 * 60_000) jobs.delete(id);
    }
  }, 60_000);
  cleanup.unref();
  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (!request.url?.startsWith('/api/ai/')) return next();
    try {
      const host = request.headers.host || '';
      if (
        !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
        (request.headers.origin && request.headers.origin !== `http://${host}`) ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        respond(response, 403, { error: 'AI requests must come from this local editor.' });
        return;
      }
      const path = new URL(request.url, `http://${host}`).pathname;
      if (path === '/api/ai/session' && request.method === 'GET') {
        respond(response, 200, { token, configured: configured() });
        return;
      }
      if (request.headers['x-expand-token'] !== token) {
        respond(response, 403, {
          error: 'Reload the editor to reconnect to the local AI service.',
        });
        return;
      }
      if (path === '/api/ai/credentials' && request.method === 'POST') {
        const data = await body(request);
        if (
          !Object.hasOwn(providers, data.provider) ||
          typeof data.key !== 'string' ||
          data.key.length > 1000 ||
          /[\r\n]/.test(data.key)
        )
          throw new Error('Enter a valid provider and API key.');
        if (data.key.trim()) keys.set(data.provider, data.key.trim());
        else keys.delete(data.provider);
        respond(response, 200, { configured: configured() });
        return;
      }
      if (path === '/api/ai/jobs' && request.method === 'POST') {
        if ([...jobs.values()].some((job) => job.state === 'running'))
          throw new Error(
            'A generation is already running. Wait or stop it before submitting another.',
          );
        if (jobs.size >= 5) {
          const oldest = [...jobs.values()].find((job) => job.state !== 'running');
          if (oldest) jobs.delete(oldest.id);
        }
        const input = validateEdit(await body(request));
        const key = keys.get(input.provider) || env[providers[input.provider].env];
        if (!key) throw new Error('Add an API key for this provider first.');
        const job: Job = {
          id: randomUUID(),
          input,
          created: Date.now(),
          controller: new AbortController(),
          state: 'running',
          message: 'Preparing generation…',
        };
        jobs.set(job.id, job);
        start(job, key);
        respond(response, 202, publicJob(job));
        return;
      }
      const match = path.match(/^\/api\/ai\/jobs\/([\w-]+)(\/resume)?$/);
      const job = match && jobs.get(match[1]);
      if (job && match) {
        if (request.method === 'GET' && !match[2]) {
          respond(response, 200, publicJob(job));
          return;
        }
        if (request.method === 'DELETE' && !match[2]) {
          job.controller.abort();
          job.state = 'stopped';
          job.message =
            'Local waiting stopped. The provider may continue and charge for this request.';
          respond(response, 200, publicJob(job));
          return;
        }
        if (request.method === 'POST' && match[2]) {
          if (job.input.provider !== 'kie' || !job.taskId || job.state === 'running')
            throw new Error('Only an existing, stopped or failed Kie task can be checked again.');
          if ([...jobs.values()].some((item) => item.state === 'running'))
            throw new Error('Another generation is already running.');
          const key = keys.get('kie') || env[providers.kie.env];
          if (!key) throw new Error('Add your Kie API key to check this task.');
          start(job, key);
          respond(response, 202, publicJob(job));
          return;
        }
      }
      respond(response, 404, {
        error: 'This AI request is unavailable. Server jobs expire after 30 minutes or a restart.',
      });
    } catch (error) {
      if (!response.headersSent)
        respond(response, 400, {
          error: error instanceof Error ? error.message : 'The AI request failed.',
        });
    }
  }
  return {
    handle,
    close: () => {
      clearInterval(cleanup);
      for (const job of jobs.values()) job.controller.abort();
      keys.clear();
      jobs.clear();
    },
  };
}
