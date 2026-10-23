import {replay, validateSchema, validateState} from '../companions/csb-character-state/src/core.js';
import {sourceScope} from './source-sync.js';

export const CSB_STATE_KEY = 'csb_character_state_v1';
const clone = value => structuredClone(value);
const normalizeName = value => typeof value === 'string' ? value.trim() : '';
const COMPAT_FIELDS = new Set(['age', 'identity', 'relation', 'height', 'weight', 'build', 'appearance', 'hair', 'eyes', 'skin', 'location', 'mood', 'condition', 'outfit', 'action', 'thought', 'items', 'note', 'affection', 'trust', 'energy', 'fatigue', 'stress', 'satiety', 'hydration', 'lewdness']);

/** Reads the native API, or replays an isolated copy for the original CSB 1.0.0. */
export function readCharacterState(context, api = globalThis.CSBCharacterState) {
  const scope = sourceScope(context);
  if (!scope || !context?.chatMetadata || !Array.isArray(context.chat)) return {snapshot: null, errors: []};
  if (context.extensionSettings?.[CSB_STATE_KEY]?.enabled === false || context.chatMetadata[CSB_STATE_KEY]?.enabled === false) return {snapshot: null, errors: []};
  const hasApi = api?.apiVersion === 1 && typeof api.getSnapshot === 'function';
  const disabled = context.extensionSettings?.disabledExtensions;
  if (!hasApi && Array.isArray(disabled) && disabled.some(path => ['csb-character-state', 'csb_character_state'].includes(String(path).replace(/\/+$/, '').split('/').at(-1)))) return {snapshot: null, errors: []};
  try {
    let snapshot, errors = [];
    if (hasApi) {
      snapshot = api.getSnapshot();
      // An API owned by another chat is never accepted or silently substituted.
      if (!snapshot || snapshot.scope !== scope || !snapshot.enabled) return {snapshot: null, errors: []};
      snapshot = clone(snapshot);
    } else {
      const original = context.chatMetadata[CSB_STATE_KEY];
      if (!original) return {snapshot: null, errors: []};
      const db = clone(original);
      db.schema = validateSchema(db.schema);
      db.seed = validateState(db.seed, db.schema);
      const result = replay(db, context.chat, {capture: true, allowNew: context.extensionSettings?.[CSB_STATE_KEY]?.allowNew !== false});
      snapshot = {scope, enabled: true, schema: db.schema, state: result.state, locks: db.locks || {}, pinned: db.pinned || []};
      errors = result.errors.map(error => ({message: `CSB：${error.message}`, messageIndex: error.index}));
    }
    const schema = validateSchema(snapshot.schema), state = validateState(snapshot.state, schema);
    return {snapshot: {...snapshot, schema, state}, errors};
  } catch (error) {
    return {snapshot: null, errors: [{message: `角色狀態工坊讀取失敗：${String(error?.message || error)}`} ]};
  }
}

function displayValue(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.join('、');
  return `${String(value)}${typeof value === 'number' && field.unit ? ` ${field.unit}` : ''}`;
}

/** Keeps stable character identities while resolving only unique names/aliases. */
export function indexCharacterState(snapshot, {editable = false} = {}) {
  const characters = snapshot ? Object.values(snapshot.state.characters) : [];
  const lookup = new Map();
  for (const character of characters) {
    for (const candidate of new Set([character.name, ...(character.aliases || [])].map(normalizeName).filter(Boolean))) {
      if (!lookup.has(candidate)) lookup.set(candidate, new Map());
      lookup.get(candidate).set(character.id, character);
    }
  }
  const fields = snapshot?.schema.fields.filter(field => !field.hidden) || [];
  const groups = snapshot?.schema.groups.filter(group => fields.some(field => field.group === group.id)) || [];
  function resolve(name) {
    const matches = lookup.get(normalizeName(name));
    if (!matches?.size) return null;
    if (matches.size !== 1) return {ambiguous: true, candidates: [...matches.keys()]};
    const character = [...matches.values()][0];
    const values = Object.fromEntries(fields.map(field => [field.id, clone(Object.hasOwn(character.values, field.id) ? character.values[field.id] : field.default)]));
    const source = {kind: 'csb', scope: snapshot.scope, characterId: character.id, version: '1.0.1'};
    return {
      name, fields: Object.fromEntries(fields.filter(field => COMPAT_FIELDS.has(field.id)).map(field => [field.id, displayValue(values[field.id], field)])),
      body: fields.filter(field => field.group === 'body').map(field => ({name: field.label, value: displayValue(values[field.id], field) ?? ''})),
      time: snapshot.state.scene.time || '', source, sources: [clone(source)], card: {},
      csb: {id: character.id, name: character.name, scope: snapshot.scope, groups: clone(groups), fields: clone(fields), values,
        aliases: clone(character.aliases || []), present: !!character.present, editable,
        locked: fields.filter(field => Object.hasOwn(snapshot.locks?.[character.id] || {}, field.id)).map(field => field.id),
        pinned: (snapshot.pinned || []).includes(character.id)},
    };
  }
  return {names: [...new Set(characters.map(character => character.name))], resolve};
}

/** Typed field facts include labels/ranges and exclude disabled schema entries. */
export function characterStatePrompt(csb) {
  if (!csb) return undefined;
  return {id: csb.id, name: csb.name, aliases: csb.aliases, present: csb.present,
    fields: csb.fields.filter(field => !field.hidden).map(field => ({id: field.id, label: field.label,
      group: csb.groups.find(group => group.id === field.group)?.label || field.group,
      type: field.type, value: csb.values[field.id], ...(field.unit ? {unit: field.unit} : {}),
      ...(['number', 'bar'].includes(field.type) ? {min: field.min, max: field.max} : {})}))};
}
