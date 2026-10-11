# Third-party license review

> **REVIEW DRAFT — not a complete distribution notice or legal clearance.** Snapshot: 2026-10-11. Dependencies keep their own licenses; original-source MIT does not relicense them.

## Method

Both lockfiles were inspected, including optional/platform and development packages. Direct packages below use installed package metadata; declarations are evidence, not a substitute for bundled license/NOTICE files. Platform packages listed in a lockfile may not be installed or shipped on this machine. Counts are package entries, not unique works. Recheck each actual browser/server/container distribution and any changed dependency versions.

## Backend direct packages

| Package                         | Installed version | Declared license | Role        |
| ------------------------------- | ----------------- | ---------------- | ----------- |
| `@aws-sdk/client-s3`            | 3.1133.0          | Apache-2.0       | runtime     |
| `@nestjs/common`                | 11.2.5            | MIT              | runtime     |
| `@nestjs/config`                | 4.0.4             | MIT              | runtime     |
| `@nestjs/core`                  | 11.2.5            | MIT              | runtime     |
| `@nestjs/jwt`                   | 11.0.2            | MIT              | runtime     |
| `@nestjs/mapped-types`          | 2.1.1             | MIT              | runtime     |
| `@nestjs/mongoose`              | 11.0.4            | MIT              | runtime     |
| `@nestjs/passport`              | 11.0.5            | MIT              | runtime     |
| `@nestjs/platform-express`      | 11.2.5            | MIT              | runtime     |
| `@nestjs/swagger`               | 11.4.7            | MIT              | runtime     |
| `@nestjs/throttler`             | 6.6.0             | MIT              | runtime     |
| `bcryptjs`                      | 3.0.3             | BSD-3-Clause     | runtime     |
| `class-transformer`             | 0.5.1             | MIT              | runtime     |
| `class-validator`               | 0.14.4            | MIT              | runtime     |
| `helmet`                        | 8.3.0             | MIT              | runtime     |
| `mongoose`                      | 8.24.4            | MIT              | runtime     |
| `nodemailer`                    | 10.0.10           | MIT-0            | runtime     |
| `openai`                        | 7.20.0            | Apache-2.0       | runtime     |
| `passport`                      | 0.7.0             | MIT              | runtime     |
| `passport-google-oauth2`        | 0.2.0             | MIT              | runtime     |
| `reflect-metadata`              | 0.2.2             | Apache-2.0       | runtime     |
| `rxjs`                          | 7.8.2             | Apache-2.0       | runtime     |
| `stripe`                        | 22.6.2            | MIT              | runtime     |
| `@eslint/eslintrc`              | 3.3.7             | MIT              | development |
| `@eslint/js`                    | 9.39.5            | MIT              | development |
| `@nestjs/cli`                   | 11.0.24           | MIT              | development |
| `@nestjs/schematics`            | 11.1.0            | MIT              | development |
| `@nestjs/testing`               | 11.2.5            | MIT              | development |
| `@types/express`                | 5.0.6             | MIT              | development |
| `@types/jest`                   | 30.0.0            | MIT              | development |
| `@types/node`                   | 22.20.3           | MIT              | development |
| `@types/nodemailer`             | 8.0.2             | MIT              | development |
| `@types/passport-google-oauth2` | 0.1.10            | MIT              | development |
| `@types/supertest`              | 6.0.3             | MIT              | development |
| `eslint`                        | 9.39.5            | MIT              | development |
| `eslint-config-prettier`        | 10.1.8            | MIT              | development |
| `eslint-plugin-prettier`        | 5.5.6             | MIT              | development |
| `globals`                       | 16.5.0            | MIT              | development |
| `jest`                          | 30.5.2            | MIT              | development |
| `prettier`                      | 3.9.7             | MIT              | development |
| `source-map-support`            | 0.5.21            | MIT              | development |
| `supertest`                     | 7.2.2             | MIT              | development |
| `ts-jest`                       | 29.4.14           | MIT              | development |
| `ts-loader`                     | 9.6.2             | MIT              | development |
| `ts-node`                       | 10.9.2            | MIT              | development |
| `tsconfig-paths`                | 4.2.0             | MIT              | development |
| `typescript`                    | 5.9.3             | Apache-2.0       | development |
| `typescript-eslint`             | 8.70.0            | MIT              | development |

### Backend lockfile declarations

| Expression       | Entries |
| ---------------- | ------- |
| (MIT OR CC0-1.0) | 2       |
| 0BSD             | 1       |
| Apache-2.0       | 60      |
| BSD-2-Clause     | 16      |
| BSD-3-Clause     | 19      |
| BlueOak-1.0.0    | 10      |
| CC-BY-4.0        | 1       |
| ISC              | 41      |
| MIT              | 650     |
| MIT-0            | 1       |
| Python-2.0       | 1       |
| UNDECLARED       | 4       |
| Unlicense        | 2       |

## Frontend direct packages

| Package                | Installed version | Declared license | Role        |
| ---------------------- | ----------------- | ---------------- | ----------- |
| `lucide-react`         | 0.468.0           | ISC              | runtime     |
| `next`                 | 16.3.6            | MIT              | runtime     |
| `react`                | 19.3.0            | MIT              | runtime     |
| `react-dom`            | 19.3.0            | MIT              | runtime     |
| `@playwright/test`     | 1.63.0            | Apache-2.0       | development |
| `@tailwindcss/postcss` | 4.3.3             | MIT              | development |
| `prettier`             | 3.9.9             | MIT              | development |
| `tailwindcss`          | 4.3.3             | MIT              | development |

### Frontend lockfile declarations

| Expression                               | Entries |
| ---------------------------------------- | ------- |
| 0BSD                                     | 1       |
| Apache-2.0                               | 19      |
| Apache-2.0 AND LGPL-3.0-or-later         | 3       |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1       |
| BSD-3-Clause                             | 1       |
| CC-BY-4.0                                | 1       |
| ISC                                      | 4       |
| LGPL-3.0-or-later                        | 10      |
| MIT                                      | 47      |
| MPL-2.0                                  | 12      |

## Missing declarations resolved from local notices

The backend lockfile lacks license fields for `busboy@1.6.0`, `passport-strategy@1.0.0`, `pause@0.0.1`, and `streamsearch@1.1.0`. Installed `busboy/LICENSE` and `streamsearch/LICENSE` contain MIT permission terms credited to Brian White; `passport-strategy/LICENSE` has MIT terms credited to Jared Hanson (2011–2013); `pause/README.md` contains MIT terms credited to TJ Holowaychuk (2012). Preserve these originals when distributing their code; the missing field alone is not proof of unlicensed software. Lockfiles were not edited to relabel dependencies.

## Distribution concerns requiring review

- Frontend lockfile: `@img/sharp-libvips-*` and some Sharp platform bundles declare LGPL-3.0-or-later, alone or in conjunction with Apache/MIT. These are optional, platform-specific entries; determine what the actual deployment/image ships. Preserve exact bundled notices and evaluate applicable source/relinking requirements for the distribution. See [Sharp installation guidance](https://sharp.pixelplumbing.com/install/). No conclusion that the whole DataVault application must use LGPL is made here.
- `lightningcss` and its platform packages declare MPL-2.0. [Mozilla's FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains file-level/source-availability obligations when distributing covered material. Determine whether tooling or covered code is shipped; do not assume every development dependency is distributed or that browser bundles are exempt.
- `caniuse-lite` declares CC-BY-4.0 in both lockfiles. Preserve applicable data attribution when distributed. Backend `argparse` declares Python-2.0. These are not MIT.
- Apache-2.0 packages include AWS SDK, OpenAI SDK, RxJS, TypeScript and Playwright. Preserve applicable LICENSE/NOTICE and modification notices from the actual package/artifact. ISC/BSD/BlueOak/0BSD/Unlicense and dual-license declarations also appear; retain their applicable notices rather than applying the repository license to them.
- Lucide's installed ISC notice includes Feather MIT portions. [NOTICE draft](NOTICE.md) retains the exact installed Lucide notice, but is not a substitute for auditing all bundled icon/dependency notices.

**TODO:** inspect package-level license exceptions and vendored native libraries; inventory actual production artifacts (including source maps and embedded notices), verify source availability where applicable, and create the final versioned third-party notice bundle. No dependency was added, removed, upgraded or patched by this task. This snapshot is not a guarantee of legal compatibility for every distribution model.
