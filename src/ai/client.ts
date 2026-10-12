import type { EditRequest, JobView, ProviderId } from './providers';

let token = '';
export async function session(): Promise<{ configured: Record<ProviderId, boolean> }> {
  const response = await fetch('/api/ai/session');
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error('AI editing needs the local service. Start this project with npm run dev.');
  const result = await response.json();
  token = result.token;
  return result;
}
async function api(path: string, method = 'GET', body?: unknown) {
  if (!token) await session();
  const response = await fetch(`/api/ai/${path}`, {
    method,
    headers: { 'X-Expand-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('The local AI service is unavailable. Restart npm run dev and reload.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The AI request failed.');
  return result;
}
export async function saveKey(provider: ProviderId, key: string) {
  return api('credentials', 'POST', { provider, key }) as Promise<{
    configured: Record<ProviderId, boolean>;
  }>;
}
export async function generateImage(
  input: EditRequest,
  signal: AbortSignal,
  progress: (job: JobView) => void,
  resumeId?: string,
): Promise<string> {
  signal.throwIfAborted();
  // A POST is never retried automatically: an interrupted submission may still be billed.
  let job: JobView = await api(
    resumeId ? `jobs/${resumeId}/resume` : 'jobs',
    'POST',
    resumeId ? undefined : input,
  );
  const stop = () => {
    void api(`jobs/${job.id}`, 'DELETE').catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    while (true) {
      progress(job);
      signal.throwIfAborted();
      if (job.state === 'completed' && job.image) return job.image;
      if (job.state === 'failed' || job.state === 'stopped') throw new Error(job.message);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      signal.throwIfAborted();
      job = await api(`jobs/${job.id}`);
    }
  } finally {
    signal.removeEventListener('abort', stop);
    if (signal.aborted)
      progress({
        ...job,
        state: 'stopped',
        image: undefined,
        message: 'Local waiting stopped. The provider may still finish and charge.',
      });
  }
}
