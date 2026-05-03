# Homey Uponor Agent Instructions

This repository is a Homey App built with TypeScript and the Homey SDK v3.

## App Manifest (CRITICAL)
- **NEVER edit `app.json` directly.** It is an auto-generated build artifact.
- To modify the app manifest, edit the files inside the `.homeycompose/` directory (e.g., `.homeycompose/app.json`) or driver-specific compose files like `drivers/*/driver.compose.json`. 
- The Homey CLI will regenerate `app.json` automatically during build.

## Code Conventions & Architecture
- **Exports:** Even when using ES modules (`export class ...`), you **must** include CommonJS exports at the bottom of the file (e.g., `module.exports = UponorApp`) for app, driver, and device classes. The Homey runtime relies on `require()` to instantiate these.
- **Build Output:** TypeScript compiles to the `.homeybuild/` directory via `tsconfig.json`. The CLI handles the deployment from there.
- **Linting:** Relies strictly on Athom's ESLint config (`npm run lint`). There is no Prettier configured; format according to existing linting rules.

## Developer Commands
- `npm run test` - Runs `homey app validate`. Use this to check for manifest, structure, or Homey-specific errors.
- `npm run build` - Compiles TypeScript and builds the app using `homey app build`.
- `npm run start` - Runs `homey app run` to deploy and test the app on a connected local Homey device.

## Testing Quirks
- **No Unit Test Framework:** There is no Jest, Mocha, or Vitest configured. "Testing" in this repository currently means validating the Homey manifest (`npm run test`) or deploying to a physical Homey device. Do not attempt to run or write `jest` tests without explicit user instructions to set up the framework.
