import { Piece } from '../../game/trackdef';
import { getItem, setItem } from '../../game/storage';

export interface SavedTemplate {
  id: string;
  name: string;
  sprite: string;
  pieces: Piece[];
}

const TEMPLATES_KEY = 'heavy-metal-templates';

export function getTemplates(): SavedTemplate[] {
  try {
    const data = getItem(TEMPLATES_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
  return [];
}

export function saveTemplate(template: Omit<SavedTemplate, 'id'>): SavedTemplate {
  const templates = getTemplates();
  const id = 'template-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  const newTemplate = { ...template, id };
  templates.push(newTemplate);
  try {
    setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch (err) {
    console.error('Failed to save template:', err);
  }
  return newTemplate;
}

export function deleteTemplate(id: string) {
  const templates = getTemplates();
  const filtered = templates.filter(t => t.id !== id);
  try {
    setItem(TEMPLATES_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Failed to delete template:', err);
  }
}
