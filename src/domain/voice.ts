/**
 * Which TTS voice the app speaks with (decided Nov 27): male, Bangladeshi accent, the more
 * natural online version when there is internet. Measured on the Pixel 7 (Google TTS):
 * bn-bd-x-ban ≈ 145–157 Hz (male, Bangladesh), bn-in-x-bnd ≈ 160 Hz (male, Kolkata),
 * bn-in-x-bnc and the plain bn-BD default ≈ 255 Hz (female). Pure TS.
 */
const PREFERRED: readonly { id: string; online?: boolean }[] = [
  { id: 'bn-bd-x-ban-network', online: true },
  { id: 'bn-bd-x-ban-local' },
  { id: 'bn-in-x-bnd-network', online: true },
  { id: 'bn-in-x-bnd-local' },
];

/** The voice identifier to use, or undefined for the phone's own bn-BD default. */
export function pickVoice(available: readonly string[], online: boolean): string | undefined {
  const have = new Set(available.map((v) => v.toLowerCase()));
  return PREFERRED.find((p) => (online || !p.online) && have.has(p.id))?.id;
}
