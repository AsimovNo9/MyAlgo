# Data Governance & Provider Policy

## Data classes

| Data | Source | MVP role | Storage intent |
|---|---|---|---|
| Rendered history | Browser | Graph evidence | Local |
| Rendered feed candidates | Browser | Candidate/evidence | Local |
| User interactions | Browser/user | Graph evidence | Local |
| User-created graph | User | Personal model | Local |
| YouTube API account facts | API | Display/account facts | Minimal, policy-controlled |
| Raw API responses | YouTube API | Not a graph input | Avoid persistent storage |
| Foundation-model output | Model | Content evidence | Only if enrichment is introduced |
| Graph | Derived | Ranking/explanation | User-controlled |

## Separation requirement

Do not merge provider-originated API Data and browser-observed evidence into one undifferentiated permanent store.

Maintain provenance.

```text
Evidence {
  source
  collected_at
  purpose
  provenance
  retention/expiry
}
```

## Deletion

Users need a clear way to:

- clear observed evidence
- reset graph
- delete individual evidence/path
- disconnect account
- delete account data

Deletion semantics must be tested, not merely documented.

## Retention

Retention is purpose-specific.

The product should avoid indefinite storage of raw provider data.

Derived data is not automatically exempt from provider policy merely because it is mathematically transformed.

### Experimental history-bootstrap retention

The MVP history observer is disabled by default. When enabled, it stores a
maximum of 10,000 locally observed evidence records, deduplicated by video ID. The normalized graph state reconciles the current History snapshot by stable video ID; legacy observation-time-keyed records are replaced rather than retained.
Each record contains only visible ID, title, creator, displayed history timestamp
when available, observation time, and browser-DOM provenance. It does not send
these records to a backend. Disabling the experiment stops further collection;
the reset/delete controls must remove retained evidence before launch.

## Cloud processing

MVP default:

```text
browser → local graph
```

Future cloud processing requires a separate data-flow review covering:

- disclosure
- consent/notice
- encryption
- processor/vendor handling
- retention
- deletion
- access controls
- applicable regional privacy requirements

## Provider policy

YouTube API requirements and Chrome Web Store requirements are separate compliance surfaces.

Do not assume satisfying one satisfies the other.

See `docs/compliance/YOUTUBE_API.md`.
