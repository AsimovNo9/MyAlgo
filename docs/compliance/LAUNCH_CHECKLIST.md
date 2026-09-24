# MyAlgo Launch Checklist

## P0 — Data-boundary validation

- [ ] Watch-history DOM spike completed
- [ ] Sufficient bootstrap evidence demonstrated
- [ ] Live-feed observation validated
- [ ] MyAlgo-injected cards excluded from observation
- [ ] Local graph storage validated
- [ ] Reset/delete behavior validated
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

- [ ] Host permissions minimized
- [ ] First-run data disclosure complete
- [ ] Privacy policy matches implementation
- [ ] Data inventory complete
- [ ] Retention/deletion policy complete
- [ ] YouTube API policy review completed
- [ ] Chrome Web Store data-use disclosure reviewed
- [ ] No secrets in extension bundle

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
