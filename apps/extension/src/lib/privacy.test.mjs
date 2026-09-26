import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from './privacy.ts';

test('privacy disclosure acceptance is versioned and exact', () => {
  assert.equal(isPrivacyDisclosureAccepted(PRIVACY_DISCLOSURE_VERSION), true);
  assert.equal(isPrivacyDisclosureAccepted(PRIVACY_DISCLOSURE_VERSION - 1), false);
  assert.equal(isPrivacyDisclosureAccepted(undefined), false);
  assert.equal(isPrivacyDisclosureAccepted(String(PRIVACY_DISCLOSURE_VERSION)), false);
});
