# MyAlgo Launch Checklist

## P0 — Data-boundary validation

- [ ] Watch-history DOM spike completed
- [ ] Sufficient bootstrap evidence demonstrated
- [ ] Live-feed observation validated
- [ ] MyAlgo-injected cards excluded from observation
- [ ] Local graph storage validated
- [ ] Reset/delete behavior validated in a clean browser profile
- [ ] YouTube API confirmed display/account-facts-only in code review

## P1 — Product

- [ ] Graph visualization works
- [ ] Additive scorer has reproducible traces
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
- [ ] Clean-profile browser test proves no observation before acceptance and deletion disables observation
- [ ] YouTube API policy review completed (#168)
- [ ] Chrome Web Store listing + Privacy practices fields reconciled against release artifact
- [ ] Stable public privacy-policy URL entered and verified in Developer Dashboard
- [ ] CI built-artifact secret scan passes and final package receives manual endpoint/credential review

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
