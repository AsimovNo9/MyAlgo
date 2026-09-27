# MyAlgo Launch Checklist

## P0 — Data-boundary validation

- [x] Watch-history DOM spike completed (#156)
- [x] Sufficient bootstrap evidence demonstrated
- [x] Live-feed observation validated (#150/#174/#183)
- [x] MyAlgo-injected cards excluded from behavioral observation paths
- [x] Local graph storage and deterministic rebuild validated (#148/#198)
- [x] Reset/delete behavior validated in a clean browser profile (#167/#199)
- [x] YouTube API repository/runtime audit completed (#168): no launch Data API endpoint/client/OAuth/cache path; CI guardrails added

## P1 — Product

- [ ] Graph visualization works
- [x] Additive scorer has reproducible traces (#151/#193)
- [x] Native feed enforcement works (#152/#204)
- [ ] “Why am I seeing this?” works
- [ ] Reduce/mute/prefer actions work
- [ ] Forget/delete semantics work
- [ ] Modes operate over one graph
- [ ] #221 / PR #223 canonical semantic scoring passes CI plus live validation: canonical neighbourhood assignments are replayable, redundant lexical/embedding source-node matches do not stack as independent score evidence, broad taxonomy remains distinguishable, and exact source-node provenance survives in traces
- [ ] #214 durable mode architecture validated against #162: candidate affinities are multi-label, durable mode clusters have stable local identity, and every active-mode score contribution resolves to the stable mode revision and exact canonical/source graph member in the deterministic trace
- [ ] Mode selection affects retrieval planning as well as reranking; short native-mode supply is measured against the current Home replacement quota and may be filled only through the existing acquired reservoir
- [ ] Mode-supply shortfall status/banner uses the same eligibility/membership contract as ranking and records bounded local diagnostics
- [ ] Valid Home source→replacement assignments and unchanged replacement DOM remain stable across ordinary reranks
- [ ] Each canonical semantic neighbourhood contributes at most one bounded score term; aliases/subtopics remain available as trace provenance rather than additive duplicates
- [ ] Recalibrated 0–100 display score is validated only after raw semantic overcount is removed

## P2 — Privacy/compliance

- [x] Manifest host/API permissions minimized in source and covered by test
- [x] Versioned in-product disclosure implemented before observation
- [x] Privacy policy source matches the local-only implementation
- [x] Data inventory and local/remote boundary documented
- [x] Retention/deletion semantics documented; full local-data deletion implemented
- [ ] Revalidate clean-profile disclosure v6: prior v5 acceptance is rejected; production artifact contains both pinned neural model sets plus runtime assets; enabling local neural semantics performs no model-host/CDN request; deletion disables observation/retrieval and clears embedding, semantic-feature, and concept-verification caches
- [x] YouTube API policy/repository boundary review completed in #168; no launch Data API integration found and CI guardrails added
- [ ] Chrome Web Store listing + Privacy practices fields reconciled against release artifact
- [ ] Stable public privacy-policy URL entered and verified in Developer Dashboard
- [x] CI built-artifact secret scan passes
- [ ] Final release package receives manual endpoint/credential review

- [x] Local concept verification runtime validated (#219/#220): only interaction-supported candidates are queued, q8 WASM verification completes locally, explicit abstention is supported, cached verified labels replace raw keyword topics when present, and failure retains the metadata path
- [x] Built artifact audit confirms both mxbai embedding and DeBERTa nli-deberta-v3-xsmall q8 assets are packaged locally

## P3 — Quality

- [x] RSS/YouTube-search acquisition foundation merged (#206/#212); retain as regression coverage
- [ ] Semantic diagnostics captured for hash, WebGPU-neural, WASM-neural, and cached runs
- [ ] Candidate coverage measured
- [ ] Empty-feed rate measured
- [ ] Replacement success and source→replacement stability measured
- [ ] Explanation usefulness tested
- [ ] D7/D14 retention measured
- [ ] User corrections measured

## P4 — Productization

- [ ] Account/sync architecture explicitly reviewed
- [ ] Cloud processing, if any, separately disclosed
- [ ] Billing validated
- [ ] Second connector deferred until first connector demonstrates retention

## Release rule

Do not mark the product launch-ready merely because the extension builds.

Launch readiness requires:

```text
working product
+
measured user value
+
documented data flows
+
provider-policy review
+
tested deletion/control
```
