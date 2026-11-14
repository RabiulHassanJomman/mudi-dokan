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

module.exports = ({ config }) => {
  const commit = git('rev-parse --short HEAD') || 'unknown';
  const dirty = git('status --porcelain') ? '+' : '';
  const count = Number(git('rev-list --count HEAD')) || 1;
  return {
    ...config,
    version: `0.1.${count}`,
    android: { ...config.android, versionCode: count },
    extra: { ...config.extra, gitCommit: commit + dirty, builtAt: new Date().toISOString() },
  };
};
