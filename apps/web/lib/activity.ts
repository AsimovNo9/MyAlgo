import type { ActivityEventType, ActivityRequest } from '@repo/shared-types';

const validActivityEventTypes: ActivityEventType[] = ['opened', 'watch_progress', 'completed', 'skipped', 'revisited'];
const maxWatchSeconds = 24 * 60 * 60;

export function normalizeActivityRequest(payload: Partial<ActivityRequest>): ActivityRequest {
  const externalId = typeof payload.externalId === 'string' ? payload.externalId.trim() : '';
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';
  const watchSeconds = payload.watchSeconds === undefined ? undefined : Number(payload.watchSeconds);
  const occurredDate = payload.occurredAt === undefined ? null : new Date(payload.occurredAt);
  const occurredAt = occurredDate === null ? undefined : Number.isNaN(occurredDate.getTime()) ? null : occurredDate.toISOString();

  if (!externalId) throw new Error('Video id is required.');
  if (!validActivityEventTypes.includes(eventType as ActivityEventType)) throw new Error(`Invalid activity event type: ${eventType}`);
  if (watchSeconds !== undefined && (!Number.isFinite(watchSeconds) || watchSeconds < 0 || watchSeconds > maxWatchSeconds)) {
    throw new Error('Watch duration is outside the allowed range.');
  }
  if (payload.occurredAt !== undefined && !occurredAt) throw new Error('Activity timestamp is invalid.');
  const normalizedOccurredAt = occurredAt ?? undefined;

  return {
    externalId,
    eventType: eventType as ActivityEventType,
    watchSeconds: watchSeconds === undefined ? undefined : Math.round(watchSeconds),
    occurredAt: normalizedOccurredAt,
  };
}