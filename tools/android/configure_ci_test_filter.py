from pathlib import Path
import sys

root = Path(sys.argv[1])
gradle = root / "app" / "build.gradle.kts"
s = gradle.read_text()

old = 'sourceAuditTests.forEach { exclude(it) }'
new = 'sourceAuditTests.forEach { exclude("**/" + it.substringAfterLast(".") + ".class") }'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("source-audit filter hook not found in generated build.gradle.kts")

additional = '''

// These contracts validate upstream repository provenance, embedded pack snapshots,
// and release-local metadata. The CI product build uses a source archive, so these
// are intentionally excluded only when the CI property is explicitly supplied.
if (providers.gradleProperty("ciSourceAuditExclusions").isPresent) {
    tasks.withType<Test>().configureEach {
        listOf(
            "DeclarativePackContractTest",
            "EffectShareEnginePackTest",
            "StabilizationProfileManagerTest",
            "StylePackPreviewCommitTest"
        ).forEach { exclude("**/" + it + ".class") }
    }
}
'''
if 'DeclarativePackContractTest' not in s:
    s += additional

gradle.write_text(s)
print("CI test filter configured")
