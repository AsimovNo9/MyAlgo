import type { FeedbackEventType, FeedbackRequest } from '@repo/shared-types';

const validFeedbackEventTypes: FeedbackEventType[] = ['not_interested', 'more_like_this', 'never_show_channel'];

export function normalizeFeedbackRequest(payload: Partial<FeedbackRequest>): FeedbackRequest {
  const contentItemId = typeof payload.contentItemId === 'string' ? payload.contentItemId.trim() : '';
  const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';

  if (!contentItemId) {
    throw new Error('Content item id is required.');
  }

  if (!validFeedbackEventTypes.includes(eventType as FeedbackEventType)) {
    throw new Error(`Invalid feedback event type: ${eventType}`);
  }

  return {
    contentItemId,
    eventType: eventType as FeedbackEventType,
  };
}
