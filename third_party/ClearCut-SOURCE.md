# ClearCut source attribution

AI Creative Studio Android uses the open-source ClearCut Android editor as its native editing base.

- Upstream: https://github.com/SysAdminDoc/ClearCut
- Pinned source commit: `ba6d118722b23386567c84bce8442a400713748b`
- License: MIT (see `third_party/ClearCut-LICENSE.txt`)
- Build strategy: CI checks out the pinned source, applies the product-specific Kotlin shell and assistant integration, runs the Android unit-test suite, and builds the APK.

The web editor continues to share the same project/API concepts; the Android editor is the native Kotlin/Compose implementation for the phone product.
