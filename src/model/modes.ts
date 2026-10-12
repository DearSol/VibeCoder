export const editingModes = [
  {
    id: 'fill',
    label: 'Generative Fill',
    description: 'Change a selected area with a prompt and optional references.',
  },
  {
    id: 'remove',
    label: 'Remove',
    description: 'Reconstruct the background behind the selected object.',
  },
  {
    id: 'expand',
    label: 'Generative Expand',
    description: 'Extend the canvas while preserving the original image’s scale and pixels.',
  },
  {
    id: 'repair',
    label: 'Local Repair',
    description: 'Sample clean pixels for a local patch. No AI request is needed.',
  },
] as const;
export type EditingMode = (typeof editingModes)[number]['id'];
