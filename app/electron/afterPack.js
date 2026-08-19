'use strict';
/**
 * Ad-hoc sign the macOS app before it is wrapped into a .dmg.
 *
 * WHY THIS IS NOT OPTIONAL ON APPLE SILICON
 * macOS requires every arm64 binary to carry at least an ad-hoc signature.
 * A completely unsigned arm64 app is not "unsigned" as far as the loader is
 * concerned, it is invalid, and macOS reports that to the user as:
 *
 *     "RankedSat is damaged and can't be opened. You should move it to Trash."
 *
 * which sends people hunting for a corrupt download that isn't corrupt. The
 * v0.3.1 build hit exactly this: CI set CSC_IDENTITY_AUTO_DISCOVERY=false,
 * electron-builder skipped signing altogether, and the arm64 dmg could not
 * launch at all.
 *
 * `codesign --sign -` is ad-hoc signing: no certificate, no Apple Developer
 * account, no cost. It does NOT get past Gatekeeper on its own (users still
 * need to allow the app once, see the README), but it does make the binary
 * loadable, which is the part that was broken.
 */
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // --deep is deprecated for real signing but is the pragmatic choice for
  // ad-hoc: Electron ships helper apps and frameworks that each need a
  // signature, and there is no entitlement/notarisation flow here to respect.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });

  // Fail the build rather than ship another dmg that cannot open.
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], {
    stdio: 'inherit',
  });

  console.log(`[afterPack] ad-hoc signed ${appName}`);
};
