import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEMPORAL_WATCH_SCHEMA,
  advanceWatchSession,
  createTemporalWatchObservation,
  createWatchSession,
  getTemporalWatchThreshold,
  isWatchThresholdReached,
  markWatchEmitted,
  resetWatchSeek,
} from './youtube-watch.ts';

test('temporal watch schema uses a bounded time threshold and short-video ratio', () => {
  assert.deepEqual(TEMPORAL_WATCH_SCHEMA, {
    version: 1,
    thresholdSeconds: 30,
    completionRatio: 0.5,
  });
  assert.equal(getTemporalWatchThreshold(600), 30);
  assert.equal(getTemporalWatchThreshold(20), 10);
  assert.equal(getTemporalWatchThreshold(null), 30);
});

test('watch session accumulates actual playback time and emits only after threshold', () => {
  let state = createWatchSession({
    videoId: 'video-a',
    exposureId: 'video-a|home|Recommended|2',
    sessionId: 'video-a|player|1',
    currentTime: 0,
    durationSeconds: 120,
  });

  state = advanceWatchSession(state, {
    currentTime: 12,
    durationSeconds: 120,
    isPlaying: true,
  });
  assert.equal(state.playedSeconds, 12);
  assert.equal(createTemporalWatchObservation(state, '2026-09-25T19:00:12.000Z'), null);

  state = advanceWatchSession(state, {
    currentTime: 30,
    durationSeconds: 120,
    isPlaying: true,
  });
  const observation = createTemporalWatchObservation(state, '2026-09-25T19:00:30.000Z');

  assert.deepEqual(observation, {
    videoId: 'video-a',
    exposureId: 'video-a|home|Recommended|2',
    sessionId: 'video-a|player|1',
    kind: 'watched',
    source: 'player',
    observedAt: '2026-09-25T19:00:30.000Z',
    provenance: 'youtube_player_telemetry',
    playedSeconds: 30,
    durationSeconds: 120,
    thresholdSeconds: 30,
  });
});

test('pause and buffering do not advance played time', () => {
  let state = createWatchSession({
    videoId: 'video-a',
    sessionId: 'video-a|player|1',
    currentTime: 0,
    durationSeconds: 120,
  });

  state = advanceWatchSession(state, { currentTime: 10, durationSeconds: 120, isPlaying: true });
  state = advanceWatchSession(state, { currentTime: 25, durationSeconds: 120, isPlaying: false });
  assert.equal(state.playedSeconds, 10);

  state = advanceWatchSession(state, { currentTime: 25, durationSeconds: 120, isPlaying: true });
  state = advanceWatchSession(state, { currentTime: 40, durationSeconds: 120, isPlaying: true });
  assert.equal(state.playedSeconds, 25);
});

test('seek jumps do not count as playback time', () => {
  let state = createWatchSession({
    videoId: 'video-a',
    sessionId: 'video-a|player|1',
    currentTime: 0,
    durationSeconds: 120,
  });

  state = advanceWatchSession(state, { currentTime: 10, durationSeconds: 120, isPlaying: true });
  state = advanceWatchSession(state, { currentTime: 90, durationSeconds: 120, isPlaying: false, isSeeking: true });
  assert.equal(state.playedSeconds, 10);

  state = resetWatchSeek(state, 90);
  state = advanceWatchSession(state, { currentTime: 95, durationSeconds: 120, isPlaying: true });
  assert.equal(state.playedSeconds, 15);
  assert.equal(isWatchThresholdReached(state), false);
});

test('short videos can become watched by natural completion without a full 30 seconds', () => {
  let state = createWatchSession({
    videoId: 'short-a',
    sessionId: 'short-a|player|1',
    currentTime: 0,
    durationSeconds: 8,
  });

  state = advanceWatchSession(state, { currentTime: 4, durationSeconds: 8, isPlaying: true });
  assert.equal(isWatchThresholdReached(state), true);
  const observation = createTemporalWatchObservation(state, '2026-09-25T19:01:04.000Z');
  assert.equal(observation?.thresholdSeconds, 4);
});

test('ending a short video after some playback emits watched evidence', () => {
  let state = createWatchSession({
    videoId: 'short-a',
    sessionId: 'short-a|player|2',
    currentTime: 0,
    durationSeconds: 12,
  });

  state = advanceWatchSession(state, { currentTime: 3, durationSeconds: 12, isPlaying: true });
  assert.equal(isWatchThresholdReached(state), false);
  const observation = createTemporalWatchObservation(state, '2026-09-25T19:02:03.000Z', true);
  assert.equal(observation?.videoId, 'short-a');
  assert.equal(observation?.playedSeconds, 3);
});

test('watch observation is emitted once per player session', () => {
  let state = createWatchSession({
    videoId: 'video-a',
    sessionId: 'video-a|player|1',
    currentTime: 0,
    durationSeconds: 60,
  });
  state = advanceWatchSession(state, { currentTime: 30, durationSeconds: 60, isPlaying: true });

  const first = createTemporalWatchObservation(state, '2026-09-25T19:03:30.000Z');
  state = markWatchEmitted(state);
  const second = createTemporalWatchObservation(state, '2026-09-25T19:03:31.000Z');

  assert.equal(first?.sessionId, 'video-a|player|1');
  assert.equal(second, null);
});
