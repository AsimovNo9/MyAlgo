import type { DurableSemanticModeCatalog } from '@repo/shared-types';

export const DURABLE_MODE_USER_CONFIG_SCHEMA_VERSION = 1 as const;
export const MAX_DURABLE_MODE_USER_CONFIG_REVISIONS = 50;

export type DurableModeUserOverride = {
  label?: string;
  pinned?: boolean;
};

export type DurableModeUserConfigRevision = {
  revision: number;
  createdAt: string;
  action: 'rename' | 'pin' | 'unpin' | 'reset_label' | 'undo';
  modeId: string;
  before: DurableModeUserOverride | null;
  after: DurableModeUserOverride | null;
  revertsRevision?: number | null;
};

export type DurableModeUserConfigState = {
  schemaVersion: typeof DURABLE_MODE_USER_CONFIG_SCHEMA_VERSION;
  currentRevision: number;
  overrides: Record<string, DurableModeUserOverride>;
  revisions: DurableModeUserConfigRevision[];
};

export const createEmptyDurableModeUserConfig = (): DurableModeUserConfigState => ({
  schemaVersion: DURABLE_MODE_USER_CONFIG_SCHEMA_VERSION,
  currentRevision: 0,
  overrides: {},
  revisions: [],
});

const cleanLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 80) : undefined;
};

const cleanOverride = (value: unknown): DurableModeUserOverride | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as DurableModeUserOverride;
  const label = cleanLabel(raw.label);
  const pinned = typeof raw.pinned === 'boolean' ? raw.pinned : undefined;
  if (label == null && pinned == null) return null;
  return {
    ...(label != null ? { label } : {}),
    ...(pinned != null ? { pinned } : {}),
  };
};

export const normalizeDurableModeUserConfig = (value: unknown): DurableModeUserConfigState => {
  if (!value || typeof value !== 'object') return createEmptyDurableModeUserConfig();
  const raw = value as Partial<DurableModeUserConfigState>;
  if (raw.schemaVersion !== DURABLE_MODE_USER_CONFIG_SCHEMA_VERSION) {
    return createEmptyDurableModeUserConfig();
  }

  const overrides: Record<string, DurableModeUserOverride> = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const [modeId, override] of Object.entries(raw.overrides)) {
      const cleanId = modeId.trim();
      const cleaned = cleanOverride(override);
      if (cleanId && cleaned) overrides[cleanId] = cleaned;
    }
  }

  const revisions = Array.isArray(raw.revisions)
    ? raw.revisions
      .filter((entry): entry is DurableModeUserConfigRevision => (
        Boolean(entry)
        && Number.isInteger(entry.revision)
        && typeof entry.createdAt === 'string'
        && typeof entry.modeId === 'string'
        && ['rename', 'pin', 'unpin', 'reset_label', 'undo'].includes(entry.action)
      ))
      .slice(-MAX_DURABLE_MODE_USER_CONFIG_REVISIONS)
      .map((entry) => ({
        ...entry,
        modeId: entry.modeId.trim(),
        before: cleanOverride(entry.before),
        after: cleanOverride(entry.after),
        revertsRevision: Number.isInteger(entry.revertsRevision) ? entry.revertsRevision : null,
      }))
    : [];

  return {
    schemaVersion: DURABLE_MODE_USER_CONFIG_SCHEMA_VERSION,
    currentRevision: Math.max(
      Number.isInteger(raw.currentRevision) ? Number(raw.currentRevision) : 0,
      revisions.at(-1)?.revision ?? 0,
    ),
    overrides,
    revisions,
  };
};

const writeOverride = (
  overrides: Record<string, DurableModeUserOverride>,
  modeId: string,
  override: DurableModeUserOverride | null,
) => {
  if (override && Object.keys(override).length > 0) overrides[modeId] = override;
  else delete overrides[modeId];
};

const appendRevision = (
  state: DurableModeUserConfigState,
  revision: Omit<DurableModeUserConfigRevision, 'revision' | 'createdAt'>,
  now: string,
): DurableModeUserConfigState => {
  const nextRevision = state.currentRevision + 1;
  return {
    ...state,
    currentRevision: nextRevision,
    revisions: [
      ...state.revisions,
      { ...revision, revision: nextRevision, createdAt: now },
    ].slice(-MAX_DURABLE_MODE_USER_CONFIG_REVISIONS),
  };
};

export const updateDurableModeUserConfig = (
  input: DurableModeUserConfigState,
  modeIdInput: string,
  change: { label?: string | null; pinned?: boolean },
  now = new Date().toISOString(),
): DurableModeUserConfigState => {
  const state = normalizeDurableModeUserConfig(input);
  const modeId = modeIdInput.trim();
  if (!modeId || modeId === 'default') throw new Error('A durable group ID is required.');

  const before = cleanOverride(state.overrides[modeId]);
  const next: DurableModeUserOverride = { ...(before ?? {}) };
  let action: DurableModeUserConfigRevision['action'] | null = null;

  if ('label' in change) {
    const label = cleanLabel(change.label);
    if (label) {
      next.label = label;
      action = 'rename';
    } else {
      delete next.label;
      action = 'reset_label';
    }
  }
  if (typeof change.pinned === 'boolean') {
    next.pinned = change.pinned;
    action = change.pinned ? 'pin' : 'unpin';
  }
  if (!action) return state;

  const after = cleanOverride(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return state;

  const overrides = { ...state.overrides };
  writeOverride(overrides, modeId, after);
  return appendRevision({ ...state, overrides }, {
    action,
    modeId,
    before,
    after,
    revertsRevision: null,
  }, now);
};

export const undoLastDurableModeUserConfigEdit = (
  input: DurableModeUserConfigState,
  now = new Date().toISOString(),
): { state: DurableModeUserConfigState; reverted: DurableModeUserConfigRevision | null } => {
  const state = normalizeDurableModeUserConfig(input);
  const revertedRevisionIds = new Set(
    state.revisions
      .filter((entry) => entry.action === 'undo' && Number.isInteger(entry.revertsRevision))
      .map((entry) => entry.revertsRevision as number),
  );
  const target = [...state.revisions]
    .reverse()
    .find((entry) => entry.action !== 'undo' && !revertedRevisionIds.has(entry.revision));
  if (!target) return { state, reverted: null };

  const overrides = { ...state.overrides };
  writeOverride(overrides, target.modeId, target.before);
  const next = appendRevision({ ...state, overrides }, {
    action: 'undo',
    modeId: target.modeId,
    before: cleanOverride(target.after),
    after: cleanOverride(target.before),
    revertsRevision: target.revision,
  }, now);
  return { state: next, reverted: target };
};

export const applyDurableModeUserConfig = (
  catalog: DurableSemanticModeCatalog | null | undefined,
  input: DurableModeUserConfigState | null | undefined,
): DurableSemanticModeCatalog | null => {
  if (!catalog) return null;
  const state = normalizeDurableModeUserConfig(input);
  return {
    ...catalog,
    modes: catalog.modes.map((mode) => {
      const override = state.overrides[mode.id];
      const inferredLabel = mode.inferredLabel ?? mode.label;
      return {
        ...mode,
        inferredLabel,
        label: override?.label ?? inferredLabel,
        pinned: override?.pinned === true,
      };
    }),
  };
};
