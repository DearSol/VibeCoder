export const providers = {
  openai: {
    name: 'OpenAI',
    model: 'gpt-image-1.5',
    hint: 'GPT Image editing models. Uses the provider’s native mask input.',
    env: 'EXPAND_OPENAI_API_KEY',
  },
  google: {
    name: 'Google Gemini',
    model: 'gemini-2.5-flash-image',
    hint: 'Choose a Gemini model that generates images. The selection is supplied as a visual guide.',
    env: 'EXPAND_GOOGLE_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    model: 'google/gemini-2.5-flash-image',
    hint: 'Requires a model with both image input and image output. Text-only models cannot edit images.',
    env: 'EXPAND_OPENROUTER_API_KEY',
  },
  kie: {
    name: 'Kie.ai',
    model: 'nano-banana-pro',
    hint: 'Experimental Nano Banana Pro adapter. Other Kie models use different input schemas and are not enabled yet.',
    env: 'EXPAND_KIE_API_KEY',
  },
} as const;
export type ProviderId = keyof typeof providers;
export type EditRequest = {
  provider: ProviderId;
  model: string;
  prompt: string;
  image: string;
  mask: string;
  guide: string;
  references: { name: string; image: string }[];
};
export type JobView = {
  id: string;
  state: 'running' | 'completed' | 'failed' | 'stopped';
  message: string;
  taskId?: string;
  image?: string;
};
