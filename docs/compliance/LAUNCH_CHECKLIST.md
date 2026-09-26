# MyAlgo Launch Checklist

## P0 — Data-boundary validation

- [x] Watch-history DOM spike completed (#156)
- [x] Sufficient bootstrap evidence demonstrated
- [x] Live-feed observation validated (#150/#174/#183)
- [x] MyAlgo-injected cards excluded from behavioral observation paths
- [x] Local graph storage and deterministic rebuild validated (#148/#198)
- [x] Reset/delete behavior validated in a clean browser profile (#167/#199)
- [ ] YouTube API confirmed display/account-facts-only in code review

## P1 — Product

- [ ] Graph visualization works
- [x] Additive scorer has reproducible traces (#151/#193)
- [ ] Native feed enforcement works
- [ ] “Why am I seeing this?” works
- [ ] Reduce/mute/prefer actions work
- [ ] Forget/delete semantics work
- [ ] Modes operate over one graph

## P2 — Privacy/compliance

- [x] Manifest host/API permissions minimized in source and covered by test
- [x] Versioned in-product disclosure implemented before observation
- [x] Privacy policy source matches the local-only implementation
- [x] Data inventory and local/remote boundary documented
- [x] Retention/deletion semantics documented; full local-data deletion implemented
- [x] Clean-profile browser test proves no observation before acceptance and deletion disables observation
- [ ] YouTube API policy review completed (#168)
- [ ] Chrome Web Store listing + Privacy practices fields reconciled against release artifact
- [ ] Stable public privacy-policy URL entered and verified in Developer Dashboard
- [x] CI built-artifact secret scan passes
- [ ] Final release package receives manual endpoint/credential review

## P3 — Quality

- [ ] Candidate coverage measured
- [ ] Empty-feed rate measured
- [ ] Replacement success measured
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
