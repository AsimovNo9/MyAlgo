export type AlgorithmMode = 'Work' | 'Learning' | 'Relax';

export type RuleType = 'always_show' | 'never_show' | 'priority';

export type FeedbackEventType = 'not_interested' | 'more_like_this' | 'never_show_channel';

export interface TopicWeight {
  topic: string;
  weight: number;
}

export interface Rule {
  id?: string;
  type: RuleType;
  condition_text: string;
  created_at?: string;
}

export interface Algorithm {
  id?: string;
  name: string;
  is_active?: boolean;
  goal_text?: string | null;
  created_at?: string;
  topic_weights?: TopicWeight[];
  rules?: Rule[];
}

export interface FeedItem {
  id: string;
  title: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  external_id: string;
  score: number;
  visible: boolean;
  reason?: string;
  matched_topics?: string[];
}

export interface FeedResponse {
  items: FeedItem[];
  algorithmId?: string;
  generatedAt: string;
}

export interface AlgorithmPayload {
  id?: string;
  name: string;
  is_active?: boolean;
  goal_text?: string | null;
  topic_weights: TopicWeight[];
  rules: Rule[];
}

export interface ClassifyRequest {
  contentItemId: string;
  title: string;
  channelName?: string | null;
}

export interface ClassifyResponse {
  id: string;
  topics: string[];
  content_type?: string | null;
  quality_score?: number | null;
  reasoning?: string | null;
}

export interface FeedbackRequest {
  contentItemId: string;
  eventType: FeedbackEventType;
}

export interface ExtensionMessage<T = unknown> {
  type: string;
  payload?: T;
}

export interface ApiErrorResponse {
  error: string;
}
