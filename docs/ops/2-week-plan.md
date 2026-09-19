# 2-week plan: Production validation and launch hardening

## Week 1: Feed quality pivot
1. Enforce strict relevance gating and a truthful no-match empty state
2. Add subscribed-only, hide Shorts, discovery, and live-content controls
3. Add relevance thresholds, duplicate suppression, and channel diversity limits
4. Test the same candidate set across algorithms and source-control combinations
5. Validate the improved feed against real production content

## Week 2: Production and launch hardening
1. Complete Google OAuth, YouTube sync, and token refresh validation
2. Encrypt OAuth tokens at rest and verify extension bundle secret hygiene
3. Add production monitoring and health checks
4. Run end-to-end QA for pause/resume, mode switching, and source controls
5. Prepare launch notes and Chrome Web Store submission materials

## Definition of done
- Real user flow works from sign-in through YouTube sync and ranking
- Production secrets are rotated and verified
- Monitoring and health checks are active
- Chrome extension is ready for submission and install testing
- Launch notes and support path are prepared
