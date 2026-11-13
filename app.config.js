// Adds build info (git commit, build time) to app.json's config; shown in the pilot log.
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
  return {
    ...config,
    extra: { ...config.extra, gitCommit: commit + dirty, builtAt: new Date().toISOString() },
  };
};
