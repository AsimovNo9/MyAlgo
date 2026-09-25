import type { ExtensionMessage } from '@repo/shared-types';

export const EXTENSION_MESSAGE_TYPES = {
  GET_FEED: 'GET_FEED',
  FEED_UPDATE: 'FEED_UPDATE',
  SET_MODE: 'SET_MODE',
  OPEN_OPTIONS: 'OPEN_OPTIONS',
  FEEDBACK: 'FEEDBACK',
  ACTIVITY: 'ACTIVITY',
  HISTORY_OBSERVATION: 'HISTORY_OBSERVATION',
  RECOMMENDATION_OBSERVATION: 'RECOMMENDATION_OBSERVATION',
  SCAN_OBSERVATIONS: 'SCAN_OBSERVATIONS',
} as const;

export type ExtensionMessageType = (typeof EXTENSION_MESSAGE_TYPES)[keyof typeof EXTENSION_MESSAGE_TYPES];

export type MessagePayloadMap = {
  [EXTENSION_MESSAGE_TYPES.GET_FEED]: { algorithmId?: string };
  [EXTENSION_MESSAGE_TYPES.FEED_UPDATE]: { feed: unknown[] };
  [EXTENSION_MESSAGE_TYPES.SET_MODE]: { mode: string };
  [EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS]: undefined;
  [EXTENSION_MESSAGE_TYPES.FEEDBACK]: { contentItemId: string; eventType: string };
  [EXTENSION_MESSAGE_TYPES.ACTIVITY]: { externalId: string; eventType: 'opened' | 'revisited' };
  [EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION]: { evidence: unknown[]; metrics: unknown };
  [EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION]: { observations: unknown[]; metrics: unknown };
  [EXTENSION_MESSAGE_TYPES.SCAN_OBSERVATIONS]: { surface: 'history' | 'home' };
};

export function createMessage<T extends ExtensionMessageType>(
  type: T,
  payload?: MessagePayloadMap[T],
): ExtensionMessage<MessagePayloadMap[T]> {
  return { type, payload };
}
