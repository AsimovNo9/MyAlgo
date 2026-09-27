# MyAlgo Privacy Policy

**Effective date:** 2026-09-27  
**Applies to:** the MyAlgo / Personal Algorithm Chrome extension local-only MVP

MyAlgo is a browser extension that builds a user-controlled Personal Algorithm Graph from activity that is observable on YouTube pages. This policy describes the data handling implemented by the local-only MVP. It does not describe hypothetical future sync, cloud enrichment, or additional connectors.

## Data MyAlgo handles

When the current in-product privacy disclosure has been accepted and MyAlgo is enabled, the extension may observe and store:

- YouTube video identifiers, titles, creator/channel information, thumbnails, and other metadata visible to or fetched by the YouTube page;
- feed exposure context such as surface, section, position, and observation time;
- rendered YouTube History items when the separate History bootstrap option is enabled;
- playback-derived watch evidence, including bounded playback metrics used to determine a watched observation;
- selections and explicit feedback such as Not interested / More like this;
- derived local Personal Algorithm Graph nodes and relationships;
- local scoring results, compact trace metadata, rebuildable semantic embeddings/similarity features, settings, and feed-control state;
- when the user enables RSS discovery, recently observed YouTube channel IDs and the resulting bounded YouTube RSS candidate metadata/provenance;
- when the user enables web discovery, bounded query terms derived from graph goals/topics and the active mode, plus resulting YouTube video IDs/titles/snippets parsed from YouTube search pages.

MyAlgo does not request Chrome's `history` permission. Its launch evidence comes from the YouTube pages on which its content script runs.

## Purpose

The extension uses this information only to provide and improve its disclosed user-facing purpose: building an inspectable local Personal Algorithm, optionally acquiring candidate updates from YouTube RSS and YouTube search pages, scoring candidates, explaining MyAlgo decisions, and applying the user's feed controls.

A YouTube item being surfaced is contextual evidence; it is not automatically treated as a user preference.

## Storage and retention

The MVP stores its Personal Algorithm state in `chrome.storage.local`, which is extension-specific browser storage. Operational stores are bounded, including candidate/metadata/event/trace caches and derived semantic embedding/similarity caches. Embeddings are recomputable derived data keyed by model/version/input identity; they are not canonical graph/evidence truth. Evidence and graph state may persist locally until the user deletes it, resets MyAlgo, or a future version applies an explicitly documented retention rule.

Because Chrome extension storage can persist independently of ordinary browser cache/history clearing, users should use MyAlgo's **Delete all local MyAlgo data** control when they want the extension's retained state removed.

## Data sharing and transfer

The local-only MVP does **not** send observed YouTube activity, evidence records, Personal Algorithm Graph state, derived embedding vectors/similarity features, feedback records, or scoring traces to a MyAlgo-operated backend or to advertising/data-broker services.

The extension runs on YouTube and may make requests to YouTube-owned origins as part of normal page operation and metadata enrichment. When the user explicitly enables RSS discovery, MyAlgo also requests bounded YouTube channel RSS feeds using channel IDs already observed from YouTube metadata. RSS requests do not contain the Personal Algorithm Graph, raw watch-history rows, feedback records, or scoring traces.

When the user explicitly enables the neural semantic encoder, MyAlgo downloads public model/configuration files for `mixedbread-ai/mxbai-embed-xsmall-v1` from the Hugging Face model host and caches those files under the extension/browser model cache. Those requests download the model only: MyAlgo does not send candidate text, Personal Algorithm Graph state, history, feedback, embeddings, or scoring traces to Hugging Face for inference. Inference remains local in the extension runtime.

When the user explicitly enables web discovery, MyAlgo sends a bounded set of normalized graph-derived goal/topic queries plus active mode intent to YouTube's normal search-page endpoint. It does not send raw watch-history rows, the full graph, explicit feedback records, scoring traces, or browser cookies with those extension-initiated search requests. Search-page results are treated only as candidate-discovery metadata; canonical YouTube watch-page enrichment remains the source of richer candidate metadata before local scoring.

The launch extension does not use observed data for personalized advertising, credit/lending decisions, or sale to data brokers.

## YouTube Data API boundary

The current launch runtime does not integrate the YouTube Data API. Browser-observed YouTube pages provide the launch evidence used by the local graph/scorer. Optional YouTube RSS discovery is a separate public-feed acquisition mechanism and does not use YouTube Data API endpoints, OAuth, API keys, or developer credentials. If YouTube Data API use is introduced later, API Data must remain separate from graph derivation, scoring, traces, and explanations unless a future version goes through a separate product, provider-policy, privacy, and disclosure review.

## User controls

Users can:

- pause MyAlgo, which stops new observation/enforcement while paused;
- separately enable or disable experimental History and Home-context collection where those controls apply;
- separately enable or disable RSS candidate discovery;
- separately enable or disable YouTube search-page candidate discovery;
- use **Delete all local MyAlgo data** in Settings to clear local evidence, graph state, caches, traces, feedback, settings, and disclosure acceptance.

After a full local-data deletion, observation remains disabled until the current privacy disclosure is affirmatively accepted again.

## Security and permissions

The extension requests `storage`, the MV3 `offscreen` permission used only to host a bundled dedicated Worker for YouTube search-page processing, and required YouTube HTTPS host access. YouTube search-page discovery uses the existing YouTube host boundary and does not add another host permission. It does not request `<all_urls>`, Chrome `history`, `tabs`, `cookies`, `webRequest`, or `scripting` permissions.

The project audits the built extension package for common secret/token patterns. Secrets and private API credentials must not be bundled in the extension.

## Changes to data practices

The privacy disclosure is versioned. Disclosure v5 covers the optional Hugging Face model-file download used by the local neural semantic encoder in PR #213. Disclosure v4 covered local semantic embedding/similarity processing before that external model-download boundary was introduced. A material change to what MyAlgo observes or derives, why it uses the data, where it sends the data, or who receives it requires a new disclosure version and renewed affirmative acceptance before the changed collection begins.

Optional sync, cloud enrichment, or a new connector is therefore not covered by the current acceptance.

## Chrome Web Store Limited Use

MyAlgo's use of information received through Chrome extension capabilities will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. User data is used only to provide or improve MyAlgo's disclosed single purpose, subject to the exceptions required by applicable policy or law.

## Contact and policy source

The implementation and this policy are maintained in the MyAlgo project repository. Before Chrome Web Store publication, the developer must provide a working public URL for this policy in the Developer Dashboard and keep that URL current.
