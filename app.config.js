// Adds build info (git commit, build time) to app.json's config; shown in the pilot log.
// Version from the git commit count on main: versionCode N, versionName 0.1.N, so every
// `npm run apk` after a commit installs as a newer update (main is never rewritten).
const { execSync } = require('child_process');

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

// Google sign-in needs the OAuth "web" client (client_type 3) of google-services.json.
const webClientId = () => {
  try {
    const gs = require('./google-services.json');
    const c = gs.client[0].oauth_client.find((o) => o.client_type === 3);
    return c ? c.client_id : null;
  } catch {
    return null;
  }
};

module.exports = ({ config }) => {
  const commit = git('rev-parse --short HEAD') || 'unknown';
  const dirty = git('status --porcelain') ? '+' : '';
  const count = Number(git('rev-list --count HEAD')) || 1;
  return {
    ...config,
    version: `0.1.${count}`,
    android: { ...config.android, versionCode: count },
    extra: { ...config.extra, googleWebClientId: webClientId(), gitCommit: commit + dirty, builtAt: new Date().toISOString() },
  };
};
