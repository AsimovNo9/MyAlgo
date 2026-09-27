# Chrome Web Store / Privacy Compliance

> **Status: implementation and clean-profile browser validation complete in #167 / PR #199; Store-dashboard release steps remain open.** This document is the release reconciliation record for the local-only MVP.

## Implemented launch boundary

The extension is Manifest V3 and requests:

- `storage`;
- `offscreen`, used only to host the bundled dedicated Worker for optional YouTube search-page fetch/parsing away from the ranking service worker;
- required HTTPS host access for `https://*.youtube.com/*`.

It does not request `<all_urls>`, Chrome `history`, `tabs`, `cookies`, `webRequest`, or `scripting`.

The YouTube host permission is required because MyAlgo's disclosed single purpose depends on observing rendered YouTube content, retrieving optional YouTube RSS/search-page candidates, enriching candidate metadata, and applying user-controlled feed decisions on those pages. The `offscreen` permission does not expand the network boundary; it isolates large search-page payload handling from the service worker that serves ranking/UI requests.

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
| Recommendation state | candidate cache, scores, compact traces, rebuildable semantic embeddings/category affinities, selected mode and feed replacement percentage | feed control/debugging and semantic reranking | local; derived caches are bounded and deletable |
| Optional RSS discovery | observed YouTube channel IDs; public feed candidate metadata | expand candidate reservoir | bounded requests to YouTube-owned RSS endpoints; results stored locally |
| Optional web-search discovery | normalized graph-derived goal/topic terms + active mode intent; returned YouTube video IDs/titles/snippets | expand candidate reservoir | bounded requests to YouTube search pages under the existing YouTube host permission; results stored locally and enriched from canonical YouTube watch pages before scoring |

The local-first MVP does not send observed activity, raw evidence, full graph state, locally extracted concepts, derived embedding vectors/similarity features, feedback records, or traces to a MyAlgo backend, analytics vendor, advertising service, data broker, or model host. Optional RSS discovery sends bounded channel-feed requests only to YouTube-owned HTTPS endpoints. Optional web discovery sends only bounded normalized graph-derived goal/topic queries plus active mode intent to YouTube search pages. Optional neural semantics uses model/runtime assets packaged with the extension artifact and requires no model-host request at runtime.

## Disclosure and affirmative acceptance

Chrome Web Store disclosure has two layers:

1. **Before installation:** the Store listing and Privacy practices tab must prominently describe the user data handled and its use. Publishing requires the developer to complete these dashboard fields.
2. **Before in-product observation:** MyAlgo uses a versioned disclosure gate. Until the current disclosure version is affirmatively accepted, the content script starts paused and the background rejects observation/ranking messages.

Disclosure v3 added optional graph-derived YouTube search-page candidate acquisition on top of the v2 YouTube RSS boundary. PR #213 incremented disclosure to v4 for bounded local semantic vectors/similarity features, then to v5 for the packaged neural embedding-provider boundary. PR #220 increments the disclosure to **v6** for locally derived concept extraction with a second packaged neural model. Both model/runtime sets are packaged at build time and the installed extension does not contact a model host. The current disclosure explains:

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

Operational stores are bounded where implemented. PR #213 additionally bounds derived semantic embedding records and graph/mode/category similarity records to 600 entries each. These derived records are model/version/input keyed and safe to discard/rebuild. Personal Algorithm evidence/graph state can persist in `chrome.storage.local` until deleted/reset or an explicit future retention rule applies.

Settings provides **Delete all local MyAlgo data**, which clears extension-local state, including persisted and in-memory semantic caches, and disclosure acceptance. Observation stays disabled after deletion until the current disclosure is accepted again.

Pause is not deletion: pausing stops new observation/enforcement but retained local state remains until deletion/reset.

## Network boundary

The extension runs on YouTube and can request YouTube-owned URLs for metadata or user navigation. With explicit RSS discovery enabled it can also request public YouTube channel RSS feeds using already observed channel IDs.

With explicit web discovery enabled, MyAlgo requests YouTube search pages using only bounded graph-derived goal/topic queries plus active mode intent. It does not send raw watch-history rows, the full Personal Algorithm Graph, feedback records, or scoring traces. Search-page snippets are discovery metadata and are followed by canonical YouTube watch-page enrichment before scoring.

With local neural semantics explicitly enabled, the extension loads packaged quantized `mixedbread-ai/mxbai-embed-xsmall-v1` embedding assets and `Xenova/nli-deberta-v3-xsmall` concept-verification assets plus the bundled Transformers.js/ONNX runtime. Inference runs locally in a sandboxed extension page. Runtime remote-model loading is disabled and there is no Hugging Face/jsDelivr model or executable-code request from the installed extension.

Any future MyAlgo-operated backend, telemetry, sync, cloud enrichment, third-party search provider, or materially different processor is a new data-flow boundary and requires review before collection begins.

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
