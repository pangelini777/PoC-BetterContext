---
description: "Dependency-upgrade discipline for Acme Checkout: risk-tiered updates, lockfile hygiene, breaking-change review, and rollback planning."
applyTo: "package.json,package-lock.json,pnpm-lock.yaml,requirements.txt,pyproject.toml,go.mod,Gemfile"
tags: [dependencies, upgrades]
---

# Dependency upgrades

Apply when adding, upgrading, or removing a third-party dependency.

1. Tier the upgrade by risk before starting: patch (bug fixes, safe to batch), minor (new APIs, review changelog), major (breaking changes, dedicated change with migration notes). A major bump bundled into an unrelated feature change MUST be split out.
2. Read the changelog for minor and major upgrades and summarize user-facing risk in the change description: which Acme Checkout paths touch the dependency (checkout rendering, payment SDK, webhook parsing) and what could break.
3. Keep lockfiles committed and in sync with manifests in the same change. A manifest edit without its lockfile update is incomplete and MUST NOT merge.
4. Verify with the dependency's own surface exercised: run the targeted test suite plus a smoke check of the affected path (for example a demo checkout against `checkout.acme-demo.example` after a payment-SDK bump). A green unrelated suite is not evidence.
5. Pin versions for production deployments; floating ranges (`latest`, `*`, unbounded caret on pre-1.0 packages) are prohibited in release branches. Development-only tooling may float only if the lockfile still pins resolution.
6. Audit new dependencies before adding: maintenance status, open critical CVEs, license compatibility, bundle-size or cold-start cost, and whether the standard library already covers the need. Prefer boring, maintained packages.
7. Remove the dependency completely when it is no longer needed: manifest entry, lockfile entries, import statements, transitive configuration, and documentation references. Dead dependency entries rot into supply-chain surface.
8. Security patches are expedited but not exempt: fast-track the upgrade, still run the targeted tests, and state the CVE identifier and affected versions in the change. Skipping verification "because it is only a patch" has caused outages.
9. Never commit vendored binaries, credentials, or registry tokens alongside an upgrade. Registry authentication belongs in CI secrets and local environment configuration, never in the repository.
10. Record a rollback plan for major upgrades: previous pinned version, migration reversibility, and the signal (error rate, latency, failed smoke check) that triggers rollback.
