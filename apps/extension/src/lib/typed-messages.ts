export type MessageType =
  | 'GET_FEED'
  | 'SET_MODE'
  | 'OPEN_OPTIONS'
  | 'FEEDBACK'
  | 'ACTIVITY'
  | 'HISTORY_OBSERVATION'
  | 'RECOMMENDATION_OBSERVATION';

export interface RuntimeMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}
