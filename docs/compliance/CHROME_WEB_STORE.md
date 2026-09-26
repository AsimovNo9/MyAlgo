# Chrome Web Store / Privacy Compliance

> **Status: implementation and clean-profile browser validation complete in #167 / PR #199; Store-dashboard release steps remain open.** This document is the release reconciliation record for the local-only MVP.

## Implemented launch boundary

The extension is Manifest V3 and requests:

- `storage`;
- HTTPS host access only for `https://*.youtube.com/*`.

It does not request `<all_urls>`, Chrome `history`, `tabs`, `cookies`, `webRequest`, or `scripting`.

The YouTube host permission is required because MyAlgo's disclosed single purpose depends on observing rendered YouTube content and applying user-controlled feed decisions on those pages. Do not add permissions for planned features.

## User-data inventory

The launch extension handles web activity / website content and user interaction data. In implementation terms this includes:

| Category | Examples | Purpose | Storage / transfer |
|---|---|---|---|
| YouTube content metadata | video ID, title, creator, visible/fetched metadata | identify candidates/evidence | local; YouTube-origin requests may be used for page metadata |
| Feed exposure context | surface, section, position, observed time | contextual evidence/correlation | local |
| History context | rendered History items, relative position | optional bootstrap/fallback evidence | local; separate setting |
| Playback evidence | video identity, bounded playback metrics | deterministic watched evidence | local |
| User interactions | selections and explicit feedback | evidence and scoring policy input | local |
| Personal Algorithm state | evidence, graph nodes/edges, revisions | user model | local |
| Recommendation state | candidate cache, scores, compact traces | feed control/debugging | local |

The local-only MVP does not send observed activity, evidence, graph state, feedback, or traces to a MyAlgo backend, analytics vendor, advertising service, or data broker.

## Disclosure and affirmative acceptance

Chrome Web Store disclosure has two layers:

1. **Before installation:** the Store listing and Privacy practices tab must prominently describe the user data handled and its use. Publishing requires the developer to complete these dashboard fields.
2. **Before in-product observation:** MyAlgo uses a versioned disclosure gate. Until the current disclosure version is affirmatively accepted, the content script starts paused and the background rejects observation/ranking messages.

The current disclosure explains:

- pages observed;
- data categories;
- purpose;
- local storage;
- transfer boundary;
- pause/delete controls.

A material data-flow change increments the disclosure version. Old acceptance is then insufficient and observation remains disabled until the new version is accepted.

## Privacy policy

`PRIVACY.md` is the implementation-matched policy source. Before Store submission:

- publish it at a stable public URL;
- enter that URL in the Chrome Web Store Developer Dashboard Privacy field;
- verify it is accessible without authentication;
- ensure the Store listing, Privacy practices answers, in-product disclosure, and implementation say the same thing.

Local-only storage does not remove the privacy-policy requirement because browsing activity and website content are user data handled by the extension.

## Chrome Web Store Privacy practices draft

Reconcile the live Developer Dashboard labels at release time. Based on the current implementation, disclose at least the categories corresponding to:

- web browsing activity / visited YouTube content;
- website content / content metadata;
- user activity / interactions.

Do not claim collection categories that the extension does not handle. Do not claim that data is transmitted to the developer when it is only stored locally. The exact dashboard taxonomy can change, so the release owner must compare these implementation categories with the current dashboard wording.

Single purpose: **build and apply a user-controlled Personal Algorithm for the YouTube pages the user visits.**

Limited Use: certify only after verifying the release artifact and policy remain consistent with Chrome Web Store requirements.

## Retention and deletion

Operational stores are bounded where implemented. Personal Algorithm evidence/graph state can persist in `chrome.storage.local` until deleted/reset or an explicit future retention rule applies.

Settings provides **Delete all local MyAlgo data**, which clears extension-local state and disclosure acceptance. Observation stays disabled after deletion until the current disclosure is accepted again.

Pause is not deletion: pausing stops new observation/enforcement but retained local state remains until deletion/reset.

## Network boundary

The extension runs on YouTube and can request YouTube-owned URLs for metadata or user navigation. This is distinct from sending the Personal Algorithm Graph to MyAlgo infrastructure.

Any future MyAlgo backend, telemetry, sync, cloud enrichment, or third-party processor is a material data-flow change and requires a new review before collection begins.

## Package/security checks

Release requirements:

- manifest permission test must pass;
- built artifact secret-pattern scan must pass;
- manually inspect the final artifact for unexpected remote endpoints and credentials;
- no private API keys, OAuth client secrets, service-account credentials, or developer tokens may be bundled;
- no remote executable code may be introduced contrary to Manifest V3 requirements.

The automated secret scan is a guardrail, not proof that no secret can exist.

## Material-change rule

Re-review #167 and increment the disclosure version before shipping any change that materially changes:

- observed pages or data categories;
- purpose of collection/use;
- remote destinations or processors;
- sync/cloud behavior;
- retention/deletion semantics;
- required host/API permissions.

## Release gate

Do not submit until all of the following are true:

- CI passes typecheck, tests, build, manifest permission checks, and artifact secret scan;
- first-run disclosure remains covered by the clean-profile validation completed after PR #199;
- no YouTube observation occurs before acceptance;
- pause and full local-data deletion remain covered by that validation;
- privacy policy has a stable public URL;
- Store listing and Privacy practices tab match the release artifact;
- #168's separate YouTube Data API boundary review is complete.
