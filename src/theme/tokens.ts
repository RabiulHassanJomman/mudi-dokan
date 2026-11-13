/**
 * Design tokens — from the "Screens › Design tokens" section of docs/Plan.md
 * (design: https://claude.ai/code/artifact/178f8815-6636-44e0-959c-4191e254c838).
 * Plain TS, no RN imports.
 */

export const colors = {
  // neutral
  bg: '#F3F5F4',
  surface: '#FFFFFF',
  ink: '#18201C',
  ink2: '#3D4842',
  muted: '#4A5650',
  border: '#C9D3CE',
  divider: '#E1E7E4',
  dividerSoft: '#E6ECE9',
  neutralTint: '#EDEFF2',
  dark: '#18201C',
  darkTile: '#2E3A34',
  onDarkMuted: '#D5DDD9',
  onColor: '#FFFFFF',

  // বিক্রি / primary (green)
  sale: '#0F6B4F',
  saleDark: '#0A4D39',
  saleTint: '#E3F1EB',
  micRing: '#CFE7DD',
  listening: { bg: '#0A4D39', ringOuter: '#0F5E46', ringInner: '#137255', close: '#136B51', bars: '#9FD3BF' },

  // বাকি / খরচ (orange)
  baki: '#B85C12',
  bakiInk: '#7A3A06',
  bakiInkPressed: '#5A2A04',
  bakiTint: '#FBEADB',
  bakiBorder: '#F0C9A4',
  lowStockQty: '#9A4A0B',

  // মাল / correction (blue)
  stock: '#1A4F8C',
  stockTint: '#E4EDF8',
} as const;

/** Product picture tile backgrounds. */
export const productTiles: Readonly<Record<string, string>> = {
  চাল: '#F2EBD9',
  ডাল: '#F6E3DA',
  তেল: '#FBF1CC',
  চিনি: '#EDEFF2',
  ডিম: '#F5EEE3',
  সাবান: '#E2EEF6',
};

export const avatarColors = ['#5B4B8A', '#1A4F8C', '#0F6B4F', '#8A3B5B'] as const;

/** Taka note chips on the cash-count screen: [face, background, edge]. */
export const noteChips = [
  [1000, '#EDE3F3', '#9A7BB3'],
  [500, '#F6E6D6', '#C99A6B'],
  [200, '#E2EFDF', '#86AE7E'],
  [100, '#E4EDF8', '#8AA9CF'],
  [50, '#F3E3E3', '#C49595'],
  [20, '#E9F0E1', '#9CB585'],
  [10, '#F5EEE3', '#C2AA86'],
] as const;

/**
 * Hind Siliguri, embedded by the expo-font config plugin (app.json).
 * On Android the family name is the file name, one family per weight —
 * use these instead of `fontWeight`.
 */
export const fonts = {
  regular: 'HindSiliguri_400Regular',
  medium: 'HindSiliguri_500Medium',
  semibold: 'HindSiliguri_600SemiBold',
  bold: 'HindSiliguri_700Bold',
} as const;

/** Font sizes (px). Ranges in the design are mapped to one step each. */
export const fontSize = {
  caption: 15,
  captionLg: 16,
  body: 18,
  bodyLg: 19,
  label: 20,
  button: 22,
  listAmount: 24,
  heading: 26,
  headingLg: 28,
  prompt: 30,
  promptLg: 36,
  amount: 34,
  amountLg: 40,
  hero: 52,
} as const;

export const spacing = {
  xxs: 6,
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  /** screen side padding */
  screen: 16,
  screenTop: 14,
} as const;

export const radius = {
  note: 8,
  sm: 12,
  icon: 14,
  tab: 16,
  card: 18,
  button: 20,
  section: 22,
  hero: 24,
  productHero: 28,
  pill: 999,
} as const;

/** Component sizes (px). */
export const size = {
  minTouch: 44,
  iconButton: 52,
  listTile: 56,
  stepper: 64,
  navTab: 76,
  bigAction: 84,
  bigActionLg: 96,
  mic: 172,
  micRing: 12,
  icon: 24,
  navIcon: 32,
} as const;
