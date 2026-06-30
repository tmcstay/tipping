# Codemagic iOS TestFlight Build Numbers

The repository root `codemagic.yaml` is the source of truth for the F1Tips iOS
TestFlight workflow. Do not make a Codemagic UI-only YAML change without making
the same reviewed change in the repository.

## Incident

App Store Connect rejected an upload because its `CFBundleVersion` was `1`,
which had already been uploaded. Apple requires every uploaded build for the
same app version to use a higher build number.

The failed workflow queried App Store Connect for the latest build number. When
that lookup returned no build, the fallback arithmetic set the native project
back to `1`.

## Working strategy

The active workflow now:

1. Generates the Expo iOS project using the existing working prebuild process.
2. Uses Codemagic's `CM_BUILD_NUMBER` as `IOS_BUILD_NUMBER`.
3. Falls back to `2` when the Codemagic value is absent.
4. Enforces a hard minimum of `2`.
5. Applies the value with `agvtool` and directly patches generated
   `Info.plist` files.
6. Prints final `CFBundleVersion` values before the IPA build.

Never reset the Codemagic build counter or native `CFBundleVersion` to `1`.
Do not restore the App Store latest-build lookup unless it has been proven
reliable for this App Store Connect app.

## Settings that must remain

- Bundle identifier: `app.tipping`
- Xcode workspace: `F1Tips.xcworkspace`
- Xcode scheme: `F1Tips`
- App Store Connect integration: `codemagic_tipping_api_key`
- Signing: Codemagic `ios_signing` with App Store distribution
- Publishing: the existing `auth: integration` configuration
- TestFlight submission: enabled

The `integrations.app_store_connect` declaration and
`publishing.app_store_connect.auth` setting are a matched pair. Removing or
renaming the integration without updating the configured Codemagic integration
causes workflow validation or publishing failures.
