export type MessageType =
  | 'GET_FEED'
  | 'SET_MODE'
  | 'OPEN_OPTIONS'
  | 'FEEDBACK'
  | 'ACTIVITY';

export interface RuntimeMessage<T = unknown> {
  type: MessageType;
  payload?: T;
}
