# WebGL Anonymity-Set Rationale: Profile-Bucketed Capability Parameters

PhantomGrid normalizes WebGL capability parameters to prevent hardware fingerprinting through unique combinations of GL limits. Rather than returning a single static cap set for all profiles (which creates contradiction fingerprints when Apple M1 caps appear alongside an NVIDIA renderer string), capabilities are bucketed by renderer profile class.

## Design Principle

Each renderer string in the profile pool maps to a capability bucket whose values are plausible for that GPU class. The goal is a large anonymity set per bucket -- many real-world devices share the same cap values within each class -- while avoiding cross-class contradictions that fingerprinters can detect.

## Bucket Mapping

Renderer strings are matched by regex in `getCapBucket()`:

| Bucket | Renderer Regex | Example Renderer Strings |
|--------|---------------|--------------------------|
| `apple` | `/Apple\s+M[12]/` or `/Iris.*Plus/` | `ANGLE (Apple, Apple M1, OpenGL 4.1)`, `ANGLE (Intel, Intel(R) Iris(R) Plus Graphics, OpenGL 4.1)` |
| `intel_low` | `/HD\s+Graphics\s+6[12]0/` | `ANGLE (Intel, Intel(R) HD Graphics 620, OpenGL 4.5)` |
| `intel_mid` | `/UHD\s+Graphics/` or `/Iris.*Xe/` | `ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)`, `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)` |
| `nvidia_mid` | Default fallback (GTX, RTX 3xxx, AMD RX) | `ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB, OpenGL 4.5)`, `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)`, `ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)` |
| `nvidia_high` | `/RTX\s+4/` | `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)` |

## Capability Values by Bucket

| Parameter | Constant | apple | intel_low | intel_mid | nvidia_mid | nvidia_high |
|-----------|----------|-------|-----------|-----------|------------|-------------|
| MAX_TEXTURE_SIZE | 0x0D33 | 16384 | 16384 | 16384 | 16384 | 32768 |
| MAX_CUBE_MAP_TEXTURE_SIZE | 0x851C | 16384 | 16384 | 16384 | 16384 | 32768 |
| MAX_RENDERBUFFER_SIZE | 0x84E8 | 16384 | 16384 | 16384 | 16384 | 32768 |
| MAX_VERTEX_ATTRIBS | 0x8869 | 16 | 16 | 16 | 16 | 16 |
| MAX_VERTEX_UNIFORM_VECTORS | 0x8872 | 4096 | 4096 | 4096 | 4096 | 4096 |
| MAX_VERTEX_TEXTURE_IMAGE_UNITS | 0x8B4C | 16 | 16 | 16 | 16 | 16 |
| MAX_VARYING_VECTORS | 0x8871 | 30 | 30 | 30 | 32 | 32 |
| MAX_FRAGMENT_UNIFORM_VECTORS | 0x8824 | 1024 | 1024 | 1024 | 1024 | 1024 |
| MAX_TEXTURE_IMAGE_UNITS | 0x8B4D | 16 | 16 | 16 | 16 | 16 |
| MAX_COMBINED_TEXTURE_IMAGE_UNITS | 0x8B4A | 32 | 32 | 32 | 32 | 32 |
| MAX_VIEWPORT_DIMS | 0x0D3D | [16384, 16384] | [16384, 16384] | [32767, 32767] | [32767, 32767] | [32767, 32767] |
| ALIASED_LINE_WIDTH_RANGE | 0x846E | [1, 1] | [1, 7.375] | [1, 7.375] | [1, 1] | [1, 1] |
| ALIASED_POINT_SIZE_RANGE | 0x8460 | [1, 255] | [1, 255] | [1, 255] | [1, 1024] | [1, 1024] |
| MAX_TEXTURE_MAX_ANISOTROPY_EXT | 0x84FF | 16 | 16 | 16 | 16 | 16 |

## Rationale by Bucket

### apple
OpenGL 4.1 limits (macOS caps Metal-backed WebGL at 4.1 compatibility profile). Viewport capped at 16384 (Metal limit on M-series). Line width [1,1] matches Apple's Metal driver behavior (no wide lines). Point size capped at 255 (Metal limit). Covers Apple M1, M2, and Intel Iris Plus on Mac -- all share these limits in Chrome/ANGLE.

### intel_low
Older integrated Intel (HD 620 class, 7th-gen mobile). Viewport 16384 (driver-limited on older Intel). Line width [1, 7.375] matches the Intel GL driver's non-integer wide-line support. Distinguishable from apple by line width range.

### intel_mid
Current-gen integrated Intel (UHD 630, Iris Xe). Viewport expanded to 32767 (driver upgrade in newer Intel). Same line width as intel_low (shared Intel GL driver behavior). The UHD 630 and Iris Xe are among the most common GPUs in desktop/laptop Chrome installs (large anonymity set).

### nvidia_mid
Discrete mid-range GPUs: GTX 1060, RTX 3060, AMD RX 580, RX 6700 XT. Line width [1,1] (NVIDIA/AMD OpenGL drivers report minimum). Point size [1, 1024] (discrete GPU capability). MAX_VARYING_VECTORS = 32 (discrete GPUs typically report higher than integrated). AMD is bucketed here because the GL cap profile is indistinguishable from NVIDIA at this parameter level -- the anonymity-set tradeoff (shared bucket) outweighs the minor cap differences.

### nvidia_high
High-end discrete: RTX 4070+. Distinguished by MAX_TEXTURE_SIZE = 32768 (Ada Lovelace architecture). Otherwise shares nvidia_mid caps. Separated because the 32768 max texture size is verifiable by fingerprinters and would contradict a mid-range renderer string.

## Known Leakage Retained

- **Shader precision:** Normalized to highp (rangeMin=127, rangeMax=127, precision=23) across all buckets. This is correct for desktop GPUs but may not match mobile-class integrated GPUs if mobile profiles are added in the future.
- **Extension list:** Shared across all buckets (20 common extensions). Some extensions may not be natively available on all hardware within a bucket; the `getExtension()` wrapper passes through to native for non-stubbed extensions.
- **MAX_TEXTURE_MAX_ANISOTROPY_EXT:** 16 across all buckets. This is the standard desktop value; hardware with lower native anisotropy (older mobile GPUs) would need a separate bucket.

## Test Coverage

Profile-bucket coherence is verified in `e2e/local/webgl-params.spec.ts`:
- `GL caps are coherent with selected renderer profile` -- asserts that Apple renderers get Apple caps, RTX 4070 gets high-end caps, Intel HD 620 gets low-end caps
- Typed-array constructors verified: `MAX_VIEWPORT_DIMS instanceof Int32Array`, `ALIASED_LINE_WIDTH_RANGE instanceof Float32Array`
- WebGL2 parity: same vendor/renderer/caps returned for WebGL2 contexts
