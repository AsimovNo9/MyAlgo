# MyAlgo Data Flow

## Launch architecture

```text
install / material disclosure
          ↓
versioned affirmative acceptance
          ↓
YouTube browser pages
          ↓
rendered page + player + interaction observation
          ↓
normalized local evidence
          ↓
Personal Algorithm Graph
          ↓
candidate acquisition (optional YouTube RSS)
          ↓
local candidate reservoir
          ↓
scoring / trace
          ↓
feed enforcement
```

Until the current disclosure version is accepted, the content script remains paused and the background rejects observation/ranking messages.

## Launch storage boundary

```text
YouTube page
   │
   ├── visible DOM / player state / user interaction
   │          ↓
   │     chrome.storage.local
   │          ├── evidence
   │          ├── graph
   │          ├── candidate/metadata caches
   │          ├── feedback/events
   │          └── compact traces/settings
   │
   └── YouTube-owned HTTPS requests used by page operation/metadata enrichment
       └── optional bounded channel RSS requests when RSS discovery is enabled

MyAlgo backend / analytics / ad network
   X  no launch transfer of observed activity, graph, feedback, or traces
```

Local storage is extension-specific and may persist independently of normal browser cache/history clearing. The Settings deletion control is therefore the authoritative in-product way to clear MyAlgo's retained local state.

## API boundary

```text
Current launch runtime:
YouTube Data API
       X  no endpoint/client/OAuth integration

Future optional API use:
YouTube Data API
       │
       └── account facts/display only by default
               X
               └── NOT graph/scoring/trace/explanation input
```

#168 audits and CI-enforces this boundary.

## Data categories

### Browser-observed

- video IDs and visible/fetched YouTube metadata;
- feed candidates and exposure context;
- optional rendered History context;
- playback-derived watch evidence;
- selections and explicit feedback.

Purpose: local evidence, graph construction, scoring, explanation, and feed control.

### User-created / user-controlled

- settings and modes;
- explicit feedback;
- future explicit graph edits.

Purpose: direct personal control.

### Acquired candidate state

When RSS discovery is explicitly enabled:

- recently observed YouTube channel IDs select bounded public RSS feeds;
- RSS candidate metadata is normalized into the existing local candidate reservoir;
- acquisition provenance records connector, mechanism, graph revision, source URL, and acquisition time;
- RSS acquisition itself is not preference evidence and does not create graph evidence.

### Derived local state

- Personal Algorithm Graph;
- graph revisions;
- candidate/feed caches;
- score/trace metadata;
- retrieval settings and privacy-safe retrieval diagnostics.

Purpose: ranking, explanation, replay/debugging, and enforcement.

### API account facts

Used only where required for approved display/account-fact purposes. They are not graph-learning evidence.

## Retention and deletion

Some operational stores have explicit size caps. Evidence and graph state can persist locally until deletion/reset unless an explicit retention/expiry rule applies.

- Pause: stop new observation/enforcement; retained data remains.
- Feature toggles: stop the associated optional observation path; retained data remains.
- Delete all local MyAlgo data: clear extension-local state and disclosure acceptance; observation remains off until acceptance is renewed.

## Future enrichment or cloud processing

Cloud sync, telemetry, hosted inference, enrichment, or a new connector changes this diagram. Before enabling such a flow:

1. define the data contract and processor/destination;
2. update the privacy policy and Store disclosures;
3. increment the in-product disclosure version;
4. obtain renewed affirmative acceptance before changed collection begins;
5. define security, retention, deletion, and failure behavior.

No future transfer is authorized merely because it appears on the roadmap.
