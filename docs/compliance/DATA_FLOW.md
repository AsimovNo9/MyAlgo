# MyAlgo Data Flow

## Launch architecture

```text
                  ┌────────────────────┐
                  │   YouTube browser  │
                  └─────────┬──────────┘
                            │
                 rendered page observation
                            │
                            ▼
                    Local evidence
                            │
                            ▼
               Personal Algorithm Graph
                            │
                    ┌───────┴───────┐
                    ▼               ▼
                 Scoring        Explanation
                    │               │
                    └───────┬───────┘
                            ▼
                     Feed enforcement
```

## API boundary

```text
YouTube Data API
       │
       └── account facts/display
               X
               │
               └── NOT graph derivation
```

## Data categories

### Browser-observed

- video IDs
- titles/metadata visible in the page
- history observations
- feed candidates
- user interactions

Purpose: graph inference and feed control.

### User-created

- nodes
- preferences
- edges
- rules
- modes

Purpose: explicit personal control.

### API account facts

Used only where required to display/confirm account facts.

## Future enrichment

If enrichment is introduced:

```text
content
  ↓
foundation model
  ↓
content evidence
  ↓
graph matching
```

The model output must carry provenance and version information.

## No hidden transfer

The MVP should not silently transmit browsing history or graph state to a third party.

Any future transfer requires an explicit product/data-flow review.
