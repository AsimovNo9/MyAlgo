# MyAlgo Privacy Policy

**Effective date:** 2026-09-26  
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
- local scoring results, compact trace metadata, settings, and feed-control state.

MyAlgo does not request Chrome's `history` permission. Its launch evidence comes from the YouTube pages on which its content script runs.

## Purpose

The extension uses this information only to provide and improve its disclosed user-facing purpose: building an inspectable local Personal Algorithm, scoring observed YouTube candidates, explaining MyAlgo decisions, and applying the user's feed controls.

A YouTube item being surfaced is contextual evidence; it is not automatically treated as a user preference.

## Storage and retention

The MVP stores its Personal Algorithm state in `chrome.storage.local`, which is extension-specific browser storage. Some operational compatibility stores are bounded (for example candidate, metadata, event, and trace caches). Evidence and graph state may persist locally until the user deletes it, resets MyAlgo, or a future version applies an explicitly documented retention rule.

Because Chrome extension storage can persist independently of ordinary browser cache/history clearing, users should use MyAlgo's **Delete all local MyAlgo data** control when they want the extension's retained state removed.

## Data sharing and transfer

The local-only MVP does **not** send observed YouTube activity, evidence records, Personal Algorithm Graph state, feedback records, or scoring traces to a MyAlgo-operated backend or to advertising/data-broker services.

The extension runs on YouTube and may make requests to YouTube-owned origins as part of normal page operation and metadata enrichment. Those requests are not transfers of the Personal Algorithm Graph to MyAlgo infrastructure.

The launch extension does not use observed data for personalized advertising, credit/lending decisions, or sale to data brokers.

## YouTube Data API boundary

The current launch runtime does not integrate the YouTube Data API. Browser-observed YouTube pages provide the launch evidence used by the local graph/scorer. If YouTube Data API use is introduced later, API Data must remain separate from graph derivation, scoring, traces, and explanations unless a future version goes through a separate product, provider-policy, privacy, and disclosure review.

## User controls

Users can:

- pause MyAlgo, which stops new observation/enforcement while paused;
- separately enable or disable experimental History and Home-context collection where those controls apply;
- use **Delete all local MyAlgo data** in Settings to clear local evidence, graph state, caches, traces, feedback, settings, and disclosure acceptance.

After a full local-data deletion, observation remains disabled until the current privacy disclosure is affirmatively accepted again.

## Security and permissions

The launch extension requests the `storage` permission and HTTPS host access limited to YouTube. It does not request `<all_urls>`, Chrome `history`, `tabs`, `cookies`, `webRequest`, or `scripting` permissions.

The project audits the built extension package for common secret/token patterns. Secrets and private API credentials must not be bundled in the extension.

## Changes to data practices

The privacy disclosure is versioned. A material change to what MyAlgo observes, why it uses the data, where it sends the data, or who receives it requires a new disclosure version and renewed affirmative acceptance before the changed collection begins.

Optional sync, cloud enrichment, or a new connector is therefore not covered by the current acceptance.

## Chrome Web Store Limited Use

MyAlgo's use of information received through Chrome extension capabilities will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. User data is used only to provide or improve MyAlgo's disclosed single purpose, subject to the exceptions required by applicable policy or law.

## Contact and policy source

The implementation and this policy are maintained in the MyAlgo project repository. Before Chrome Web Store publication, the developer must provide a working public URL for this policy in the Developer Dashboard and keep that URL current.
