import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedClassificationTopics, groupSeedChannelsByChannel } from './seed-channels.ts';

test('groupSeedChannelsByChannel groups multiple topics for the same channel and fetches it once', () => {
  const groups = groupSeedChannelsByChannel([
    { topic: 'Nuclear Engineering', channel_id: 'UC_nuclear' },
    { topic: 'Reactor Safety', channel_id: 'UC_nuclear' },
    { topic: 'Semiconductor Research', channel_id: 'UC_chips' },
  ]);

  assert.equal(groups.length, 2);
  const nuclear = groups.find((group) => group.channelId === 'UC_nuclear');
  assert.deepEqual(nuclear?.topics.sort(), ['Nuclear Engineering', 'Reactor Safety']);
  const chips = groups.find((group) => group.channelId === 'UC_chips');
  assert.deepEqual(chips?.topics, ['Semiconductor Research']);
});

test('groupSeedChannelsByChannel skips rows missing a topic or channel id', () => {
  const groups = groupSeedChannelsByChannel([
    { topic: '', channel_id: 'UC_nuclear' },
    { topic: 'Nuclear Engineering', channel_id: '' },
  ]);

  assert.deepEqual(groups, []);
});

test('buildSeedClassificationTopics guarantees the curated topic regardless of detected topics', () => {
  assert.deepEqual(
    buildSeedClassificationTopics(['Nuclear Engineering'], ['AI', 'Nuclear Engineering']),
    ['Nuclear Engineering', 'AI'],
  );
  assert.deepEqual(buildSeedClassificationTopics(['Gaming'], []), ['Gaming']);
});
