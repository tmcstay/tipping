const MINIMUM_IOS_BUILD_NUMBER = 2;
const DEFAULT_BUNDLE_IDENTIFIER = "app.tipping";

module.exports = ({ config }) => {
  const configuredBuildNumber =
    process.env.IOS_BUILD_NUMBER ??
    process.env.CM_BUILD_NUMBER ??
    config.ios?.buildNumber ??
    String(MINIMUM_IOS_BUILD_NUMBER);
  const bundleIdentifier =
    process.env.BUNDLE_ID ??
    config.ios?.bundleIdentifier ??
    DEFAULT_BUNDLE_IDENTIFIER;

  if (!/^\d+$/.test(configuredBuildNumber)) {
    throw new Error(
      `IOS_BUILD_NUMBER must be a positive integer, received: ${configuredBuildNumber}`
    );
  }

  const numericBuildNumber = Number(configuredBuildNumber);
  const resolvedBuildNumber = Math.max(
    numericBuildNumber,
    MINIMUM_IOS_BUILD_NUMBER
  );

  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier,
      buildNumber: String(resolvedBuildNumber)
    }
  };
};
