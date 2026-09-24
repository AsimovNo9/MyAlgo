# Chrome Web Store / Privacy Compliance

## MVP data boundary

The initial product should request only the YouTube host permissions actually required for observation/enforcement.

Avoid broad `<all_urls>` access.

## First-run disclosure

The extension should explain:

- what pages it observes
- what information it reads
- why it reads it
- where the information is stored
- whether information leaves the device
- how the user can clear/reset it

## Local-only MVP

Local processing reduces cloud-transfer and server-side processing concerns.

It does **not** eliminate:

- extension disclosure obligations
- platform terms
- privacy-law obligations
- data minimization requirements
- YouTube-specific restrictions

## Future cloud processing

Introducing cloud enrichment is a material data-flow change.

Before enabling it:

1. update disclosure
2. update privacy policy
3. document data categories
4. document vendors/processors
5. establish encryption in transit/at rest
6. establish retention/deletion
7. review applicable privacy requirements
8. re-review Chrome Web Store data-use disclosures

## Permissions

Keep permissions narrow and purpose-driven.

Do not request future permissions “just in case.”

## Release gate

Chrome Web Store submission should not occur until:

- permission inventory is final
- disclosure matches implementation
- privacy policy matches implementation
- deletion/reset behavior works
- no secrets are bundled
- extension package is reviewed
