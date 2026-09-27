# Data Governance & Provider Policy

## Data classes

| Data | Source | MVP role | Storage intent |
|---|---|---|---|
| Rendered history | Browser | Graph evidence | Local |
| Rendered feed candidates | Browser | Candidate/evidence | Local |
| RSS/search-acquired candidate metadata | YouTube public RSS/search pages, opt-in | Candidate acquisition only; **not preference evidence** | Local bounded candidate reservoir/provenance |
| User interactions | Browser/user | Graph evidence | Local |
| User-created graph | User | Personal model | Local |
| YouTube API account facts | API | **Not currently integrated**; future display/account-fact use only after review | No launch store |
| Raw API responses | YouTube API | **Not currently integrated**; never a graph/scoring input by default | No launch store; future use must define policy-compliant refresh/deletion |
| Local semantic embeddings/similarities | Local model/provider | Rebuildable candidate/graph/mode features; **not canonical preference state** | Bounded local derived caches; delete/recompute safely |
| Foundation-model output | Model | Content evidence | Only if later enrichment is introduced |
| Graph | Derived | Ranking/explanation | User-controlled |

## Separation requirement

Do not merge provider-originated API Data and browser-observed evidence into one undifferentiated permanent store.

Maintain provenance. Candidate acquisition provenance is distinct from evidence provenance: RSS/web-search acquisition records how a candidate entered the reservoir and must not become graph evidence merely because it was retrieved.

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

## Disclosure gate

The local-only MVP uses a versioned in-product privacy disclosure. Observation and ranking remain disabled until the current version is affirmatively accepted. A material data-flow change requires a disclosure-version increment and renewed acceptance before changed collection begins.

A full local-data deletion clears disclosure acceptance, persisted semantic caches, and their service-worker in-memory cache state as well as retained extension state, so observation or derived semantic processing cannot silently restart from deleted state after reset.

### Candidate acquisition retention

RSS and YouTube search-page discovery are disabled by default. When enabled, MyAlgo sends bounded requests only to YouTube-owned HTTPS endpoints using normalized channel IDs or graph-derived goal/topic + mode query terms. Results enter the existing bounded local candidate reservoir; acquisition history is retained separately from browser-observation evidence and does not itself alter the Personal Algorithm Graph.

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

YouTube API requirements and Chrome Web Store requirements are separate compliance surfaces. The #168 audit found no YouTube Data API endpoint/client/OAuth/cache path in the current launch runtime; CI now guards that absence.

Do not assume satisfying one satisfies the other.

See `docs/compliance/YOUTUBE_API.md`.
