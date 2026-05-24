# Duppel v0.1.1 Release Notes

## Release Artifact

- Tag: `v0.1.1`
- Commit: `73bde1f3f95f8e4a19210aff772e3c05415f8695`
- Artifact: `duppel-v0.1.1.zip`
- SHA256: `05d884ccff2011e217df07beaaff5eb5e108abf35ea3f0e978c4823d78085ab5`
- Manifest version: `0.1.1`

## Highlights

- Adds strict-next-nav coherence so first document navigation stays native and persona mode begins on the next navigation.
- Narrows spoofed persona selection to browser/OS families compatible with the underlying browser substrate.
- Keeps `strictFirstDoc` enabled by default for production.
- Removes the legacy `__pg_s` seed transport path, retaining only update-time cleanup for stale cookies.
- Adds Native-Compatible Mode as the recovery path for sites that reject persona mode.

## Smoke Results

The controlled v0.1.1 smoke matrix verified eight sites:

- Full pass: Cloudflare, Discord, LinkedIn, Facebook, BestBuy, Wikipedia.
- Degraded in persona mode: OpenAI and B&H Photo.
- Native-Compatible Mode restored both degraded sites to `200 OK`.
- No challenge loops were observed.

Evidence archive: `/Volumes/Mesh/Duppel/v0.1.1-controlled-smoke/`

## Known Limitation

Duppel v0.1.1 should not be described as universal compatibility with high-posture Cloudflare Enterprise properties. strict-next-nav prevents first-contact split-brain and avoids challenge loops, but some high-posture sites may still challenge persona mode. Native-Compatible Mode restores native identity behavior for those sites.

## Release Discipline

This release is bound to the exact commit and artifact SHA listed above. Do not retag `v0.1.1` to a different commit or replace the release asset without a new review cycle.
