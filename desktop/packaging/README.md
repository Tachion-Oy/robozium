# Linux packaging

Everything that turns the desktop app into an installable, upgradable Debian
package. `npm run package:linux` builds the `.deb` itself; these files ship it.

| File | What it is | Used by |
| --- | --- | --- |
| `robozium-archive-keyring.asc` | Public key users' apt checks releases with. The private half is the `APT_SIGNING_KEY` Actions secret. | README install commands, `apt-repository.mjs` |
| `apt-repository.mjs` | Checks the release version, fetches the previous release, builds and signs the apt repository. | [Release](../../.github/workflows/release.yml) |
| `check-upgrade.mjs` | Upgrades from an older `.deb` and fails if the user's projects, encrypted keys or profile are lost. | [Release](../../.github/workflows/release.yml), [Linux package](../../.github/workflows/package.yml) |

Release: bump `version` in `desktop/package.json`, merge, then push the tag
`v<version>`.
