const { execFileSync } = require('child_process');
const path = require('path');

// IMPORTANT NOTE: ad-hoc sign only (no paid Developer ID cert). Without any
// signature at all, arm64 macOS refuses to launch the app and shows a
// misleading "is damaged" error instead of the normal unidentified-developer
// prompt. Upgrade to a real Developer ID + notarization if this ever needs
// to avoid that prompt entirely.
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
};
