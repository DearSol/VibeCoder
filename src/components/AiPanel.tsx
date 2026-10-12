import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { providers, type EditRequest, type JobView, type ProviderId } from '../ai/providers';
import { saveKey, session } from '../ai/client';
import { referenceImage } from '../ai/images';
import { editingModes, type EditingMode } from '../model/modes';

export type AiSettings = Pick<EditRequest, 'provider' | 'model' | 'prompt' | 'references'> & {
  blending: 'none' | 'feather' | 'poisson';
  operation: Exclude<EditingMode, 'repair'>;
};
export function AiPanel({
  disabled,
  canGenerate,
  onGenerate,
  job,
  onResume,
  mode,
}: {
  disabled: boolean;
  canGenerate: boolean;
  onGenerate: (settings: AiSettings) => void;
  job: JobView | null;
  onResume: () => void;
  mode: EditingMode;
}) {
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [models, setModels] = useState<Record<ProviderId, string>>({
    openai: providers.openai.model,
    google: providers.google.model,
    openrouter: providers.openrouter.model,
    kie: providers.kie.model,
  });
  const [configured, setConfigured] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [available, setAvailable] = useState(false),
    [saving, setSaving] = useState(false);
  const [key, setKey] = useState(''),
    [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState<EditRequest['references']>([]);
  const [blending, setBlending] = useState<AiSettings['blending']>('none');
  const [message, setMessage] = useState('');
  useEffect(() => {
    void session()
      .then((data) => {
        setConfigured(data.configured);
        setAvailable(true);
      })
      .catch((error) => setMessage(error.message));
  }, []);
  async function keyAction(value: string) {
    setSaving(true);
    setMessage('');
    try {
      setConfigured((await saveKey(provider, value)).configured);
      setKey('');
      setMessage(
        value
          ? 'Key set for this server session.'
          : 'Session key removed. Environment keys, if configured, still apply.',
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (mode === 'repair') return null;
  const action =
    mode === 'expand'
      ? 'Generate expansion'
      : mode === 'remove'
        ? 'Generate removal'
        : 'Generate edit';
  return (
    <section className="inspector-section ai-section" aria-label="AI editing">
      <div className="section-heading">
        <span>{editingModes.find((item) => item.id === mode)!.label}</span>
        <Sparkles size={15} />
      </div>
      <fieldset disabled={disabled || saving}>
        <label className="setting-label" htmlFor="ai-provider">
          Provider
        </label>
        <select
          id="ai-provider"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as ProviderId);
            setKey('');
            setMessage('');
          }}
        >
          {Object.entries(providers).map(([id, info]) => (
            <option key={id} value={id}>
              {info.name}
            </option>
          ))}
        </select>
        <label className="setting-label" htmlFor="ai-model">
          Image model
        </label>
        <input
          id="ai-model"
          value={models[provider]}
          readOnly={provider === 'kie'}
          maxLength={150}
          onChange={(event) => setModels({ ...models, [provider]: event.target.value })}
        />
        <p className="setting-help">{providers[provider].hint}</p>
        <details className="ai-key-settings">
          <summary>API key · {configured[provider] ? 'configured' : 'needed'}</summary>
          <label className="setting-label" htmlFor="ai-key">
            {providers[provider].name} API key
          </label>
          <input
            id="ai-key"
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
          <div className="ai-actions">
            <button
              className="button secondary"
              disabled={!available || !key.trim()}
              onClick={() => void keyAction(key)}
            >
              Use key
            </button>
            <button
              className="button secondary"
              disabled={!available || !configured[provider]}
              onClick={() => void keyAction('')}
            >
              Forget
            </button>
          </div>
          <p className="setting-help">
            Held in the local server’s memory until it stops. Keys are never saved in projects or
            browser storage.
          </p>
        </details>
        <label className="setting-label" htmlFor="ai-prompt">
          {mode === 'fill' ? 'Describe your edit' : 'Optional guidance'}
        </label>
        <textarea
          id="ai-prompt"
          rows={3}
          maxLength={8000}
          placeholder={
            mode === 'expand'
              ? 'Leave blank for natural scene continuation…'
              : mode === 'remove'
                ? 'Leave blank to reconstruct the background…'
                : 'Describe what should replace the selected area…'
          }
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <label className="setting-label" htmlFor="ai-references">
          Reference images · {references.length}/4
        </label>
        <input
          id="ai-references"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={async (event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            if (files.length + references.length > 4) {
              setMessage('Use up to four reference images.');
              return;
            }
            setSaving(true);
            try {
              const added = await Promise.all(files.map(referenceImage));
              setReferences([...references, ...added]);
              setMessage('');
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        />
        <div className="ai-references">
          {references.map((ref, index) => (
            <div key={`${index}-${ref.name}`}>
              <img src={ref.image} alt={`Reference ${index + 1}: ${ref.name}`} />
              <span>
                {index + 1}. {ref.name}
              </span>
              <button
                aria-label={`Remove reference ${index + 1}`}
                onClick={() => setReferences(references.filter((_, i) => i !== index))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        {mode !== 'expand' && (
          <>
            <label className="setting-label" htmlFor="ai-blend">
              AI seam blending
            </label>
            <select
              id="ai-blend"
              value={blending}
              onChange={(event) => setBlending(event.target.value as AiSettings['blending'])}
            >
              <option value="none">None · keep generated colors</option>
              <option value="feather">Feather · use inward feather</option>
              <option value="poisson">Poisson · match surrounding tones</option>
            </select>
          </>
        )}
        <p className="setting-help">
          Sends {mode === 'expand' ? 'the proposed canvas' : 'a square crop around your selection'}{' '}
          and all listed references to {providers[provider].name}. Kie also uploads these inputs to
          its file service. One result per request; provider charges apply. Cost estimate
          unavailable.
        </p>
        <button
          className="button primary full"
          disabled={
            !available ||
            !configured[provider] ||
            !canGenerate ||
            (mode === 'fill' && !prompt.trim()) ||
            !models[provider].trim()
          }
          onClick={() =>
            onGenerate({
              provider,
              model: models[provider].trim(),
              prompt: prompt.trim(),
              references,
              blending: mode === 'expand' ? 'none' : blending,
              operation: mode,
            })
          }
        >
          <Sparkles size={14} />
          {action}
        </button>
        {!canGenerate && (
          <p className="setting-help">
            {mode === 'expand'
              ? 'Set at least one expansion margin first.'
              : 'Open an image and select an area first.'}
          </p>
        )}
      </fieldset>
      {message && (
        <p className="setting-help" role="status">
          {message}
        </p>
      )}
      {job && (
        <div className="ai-job">
          <p>{job.message}</p>
          {job.taskId && (
            <p>
              Task: <code>{job.taskId}</code>
            </p>
          )}
          {job.taskId && ['failed', 'stopped'].includes(job.state) && (
            <button className="button secondary" disabled={disabled} onClick={onResume}>
              Check existing Kie task
            </button>
          )}
        </div>
      )}
    </section>
  );
}
