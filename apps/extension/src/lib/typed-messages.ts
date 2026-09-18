export type MessageType =
  | 'GET_FEED'
  | 'SET_MODE'
  | 'OPEN_OPTIONS'
  | 'FEEDBACK';

export interface RuntimeMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}
