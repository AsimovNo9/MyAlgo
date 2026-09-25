export type MessageType =
  | 'GET_FEED'
  | 'GET_BEHAVIOR'
  | 'SET_MODE'
  | 'OPEN_OPTIONS'
  | 'FEEDBACK'
  | 'ACTIVITY'
  | 'HISTORY_OBSERVATION'
  | 'RECOMMENDATION_OBSERVATION'
  | 'SELECTION_OBSERVATION'
  | 'WATCH_OBSERVATION';

export interface RuntimeMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}
