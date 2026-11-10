import packageJson from '../../package.json';

const [major = '0', minor = '0', patch = '0'] = packageJson.version.split('.');

/** Public product version. package.json keeps the full semver (for example 0.7.0). */
export const APP_VERSION = `${major}.${minor}`;

/** Monotonic native build number: 0.7.0 → 700, 0.8.0 → 800, 1.0.0 → 10000. */
export const APP_BUILD = Number(major) * 10_000 + Number(minor) * 100 + Number(patch);
