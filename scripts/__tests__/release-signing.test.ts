// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patch } = require('../../plugins/withReleaseSigning') as { patch: (s: string) => string };

/** Shape of Expo's generated android/app/build.gradle (SDK 58). */
const GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

describe('release signing plugin', () => {
  const out = patch(GRADLE);
  it('release build type uses the release key; debug stays on the debug key', () => {
    const buildTypes = out.slice(out.indexOf('buildTypes {'));
    const debug = buildTypes.slice(0, buildTypes.indexOf('release {'));
    const release = buildTypes.slice(buildTypes.indexOf('release {'));
    expect(debug).toContain('signingConfig signingConfigs.debug');
    expect(release).toContain('signingConfig signingConfigs.release');
    expect(release).not.toContain('signingConfigs.debug');
  });
  it('reads path, passwords and alias from Gradle properties / env, no secrets in the file', () => {
    for (const k of ['MUDI_RELEASE_STORE_FILE', 'MUDI_RELEASE_STORE_PASSWORD', 'MUDI_RELEASE_KEY_ALIAS', 'MUDI_RELEASE_KEY_PASSWORD'])
      expect(out).toContain(`mudi('${k}')`);
    expect(out).toContain('System.getenv(k)');
  });
  it('fails a release build without the keystore instead of using the debug key', () => {
    expect(out).toContain('throw new GradleException("Release keystore not found');
  });
  it('is idempotent (prebuild runs it again)', () => {
    expect(patch(out)).toBe(out);
  });
  it('throws if Expo changes the template', () => {
    expect(() => patch('android {}')).toThrow('signingConfigs');
  });
});
