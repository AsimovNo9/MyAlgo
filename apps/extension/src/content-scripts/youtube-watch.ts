export const TEMPORAL_WATCH_SCHEMA = {
  version: 1,
  thresholdSeconds: 30,
  completionRatio: 0.5,
} as const;

export type TemporalWatchObservation = {
  videoId: string;
  exposureId: string | null;
  sessionId: string;
  kind: 'watched';
  source: 'player';
  observedAt: string;
  provenance: 'youtube_player_telemetry';
  playedSeconds: number;
  durationSeconds: number | null;
  thresholdSeconds: number;
};

export type WatchSessionState = {
  videoId: string;
  exposureId: string | null;
  sessionId: string;
  playedSeconds: number;
  lastCurrentTime: number | null;
  seeking: boolean;
  emitted: boolean;
  durationSeconds: number | null;
};

export function createWatchSession(input: {
  videoId: string;
  exposureId?: string | null;
  sessionId: string;
  currentTime?: number;
  durationSeconds?: number | null;
}): WatchSessionState {
  return {
    videoId: input.videoId,
    exposureId: input.exposureId ?? null,
    sessionId: input.sessionId,
    playedSeconds: 0,
    lastCurrentTime: Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime as number) : null,
    seeking: false,
    emitted: false,
    durationSeconds: Number.isFinite(input.durationSeconds)
      ? Math.max(0, input.durationSeconds as number)
      : null,
  };
}

export function getTemporalWatchThreshold(durationSeconds: number | null): number {
  if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.min(
      TEMPORAL_WATCH_SCHEMA.thresholdSeconds,
      durationSeconds * TEMPORAL_WATCH_SCHEMA.completionRatio,
    );
  }
  return TEMPORAL_WATCH_SCHEMA.thresholdSeconds;
}

export function advanceWatchSession(
  state: WatchSessionState,
  input: {
    currentTime: number;
    durationSeconds?: number | null;
    isPlaying: boolean;
    isSeeking?: boolean;
  },
): WatchSessionState {
  const currentTime = Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime) : state.lastCurrentTime;
  const durationSeconds = Number.isFinite(input.durationSeconds)
    ? Math.max(0, input.durationSeconds as number)
    : state.durationSeconds;

  if (currentTime == null) return { ...state, durationSeconds };

  if (input.isSeeking || state.seeking || !input.isPlaying) {
    return {
      ...state,
      durationSeconds,
      lastCurrentTime: currentTime,
      seeking: Boolean(input.isSeeking),
    };
  }

  const previous = state.lastCurrentTime;
  const delta = previous == null ? 0 : currentTime - previous;
  const playedSeconds = delta > 0 ? state.playedSeconds + delta : state.playedSeconds;

  return {
    ...state,
    durationSeconds,
    lastCurrentTime: currentTime,
    seeking: false,
    playedSeconds,
  };
}

export function resetWatchSeek(state: WatchSessionState, currentTime: number): WatchSessionState {
  return {
    ...state,
    lastCurrentTime: Number.isFinite(currentTime) ? Math.max(0, currentTime) : state.lastCurrentTime,
    seeking: false,
  };
}

export function isWatchThresholdReached(
  state: WatchSessionState,
  ended = false,
): boolean {
  const threshold = getTemporalWatchThreshold(state.durationSeconds);
  if (state.playedSeconds >= threshold) return true;

  return Boolean(
    ended
    && state.durationSeconds != null
    && state.durationSeconds > 0
    && state.durationSeconds <= TEMPORAL_WATCH_SCHEMA.thresholdSeconds
    && state.playedSeconds > 0,
  );
}

export function createTemporalWatchObservation(
  state: WatchSessionState,
  observedAt: string,
  ended = false,
): TemporalWatchObservation | null {
  if (state.emitted || !isWatchThresholdReached(state, ended)) return null;

  return {
    videoId: state.videoId,
    exposureId: state.exposureId,
    sessionId: state.sessionId,
    kind: 'watched',
    source: 'player',
    observedAt,
    provenance: 'youtube_player_telemetry',
    playedSeconds: Number(state.playedSeconds.toFixed(3)),
    durationSeconds: state.durationSeconds,
    thresholdSeconds: Number(getTemporalWatchThreshold(state.durationSeconds).toFixed(3)),
  };
}

export function markWatchEmitted(state: WatchSessionState): WatchSessionState {
  return { ...state, emitted: true };
}
