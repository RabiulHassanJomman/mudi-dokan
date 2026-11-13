import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke icons from the design (24×24 viewBox, round caps). */
export type IconName =
  | 'cart' | 'box' | 'book' | 'speaker' | 'mic' | 'keyboard'
  | 'back' | 'plus' | 'minus' | 'check' | 'close' | 'cash' | 'play' | 'list'
  | 'settings' | 'keypad' | 'arrow' | 'search' | 'image'
  // product pictures (Pick.dc.html)
  | 'rice' | 'dal' | 'oil' | 'sugar' | 'egg' | 'soap';

/** Product name → its picture; anything else is a box. */
const PRODUCT_ICONS: Readonly<Record<string, IconName>> = {
  চাল: 'rice', চাউল: 'rice', ডাল: 'dal', তেল: 'oil', চিনি: 'sugar', ডিম: 'egg', সাবান: 'soap',
};
export const productIcon = (name: string): IconName =>
  PRODUCT_ICONS[name.normalize('NFC')] ?? PRODUCT_ICONS[name.split(' ').at(-1) ?? ''] ?? 'box';

const PRODUCT_PATHS: Partial<Record<IconName, string>> = {
  rice: 'M7 4h10l-1 3c2 2 3 5 3 8a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5c0-3 1-6 3-8z M8 7h8',
  dal: 'M3 11h18a9 9 0 0 1-18 0z M8 8a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M11 7a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M14 8a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  oil: 'M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z M8 13h8',
  sugar: 'M4 11h7v7H4z M13 11h7v7h-7z M8.5 4h7v7h-7z',
  egg: 'M12 3c4 0 7 6 7 11a7 7 0 0 1-14 0c0-5 3-11 7-11z',
  soap: 'M7 9h10a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4z M6.5 5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M12 4a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
};

interface Props {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color, strokeWidth = 1.8 }: Props) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {name === 'cart' && (
        <>
          <Path {...p} d="M3 4h2l2.4 11h10.2L20 8H7" />
          <Circle {...p} cx={10} cy={20} r={1.5} />
          <Circle {...p} cx={17} cy={20} r={1.5} />
        </>
      )}
      {name === 'box' && (
        <>
          <Path {...p} d="M3 7l9-4 9 4-9 4-9-4z" />
          <Path {...p} d="M3 7v10l9 4 9-4V7" />
          <Path {...p} d="M12 11v10" />
        </>
      )}
      {name === 'book' && (
        <>
          <Path {...p} d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" />
          <Path {...p} d="M4 17a3 3 0 0 1 3-3h11" />
        </>
      )}
      {name === 'speaker' && (
        <>
          <Path {...p} d="M4 9v6h4l5 4V5L8 9H4z" />
          <Path {...p} d="M16 9a4 4 0 0 1 0 6" />
          <Path {...p} d="M19 6a8 8 0 0 1 0 12" />
        </>
      )}
      {name === 'mic' && (
        <>
          <Rect {...p} x={9} y={3} width={6} height={11} rx={3} />
          <Path {...p} d="M5 11a7 7 0 0 0 14 0" />
          <Path {...p} d="M12 18v3" />
        </>
      )}
      {name === 'back' && <Path {...p} d="M15 6l-6 6 6 6" />}
      {name === 'plus' && <Path {...p} d="M5 12h14M12 5v14" />}
      {name === 'minus' && <Path {...p} d="M5 12h14" />}
      {name === 'check' && <Path {...p} d="M5 12l5 5 9-10" />}
      {name === 'close' && <Path {...p} d="M6 6l12 12M18 6L6 18" />}
      {name === 'cash' && (
        <>
          <Rect {...p} x={2} y={6} width={20} height={12} rx={2} />
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path {...p} d="M6 12h.01M18 12h.01" />
        </>
      )}
      {name === 'play' && <Path d="M8 5v14l11-7z" fill={color} />}
      {name === 'list' && <Path {...p} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />}
      {PRODUCT_PATHS[name] && <Path {...p} d={PRODUCT_PATHS[name]} />}
      {name === 'settings' && (
        <>
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path {...p} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </>
      )}
      {name === 'keypad' && (
        <Path {...p} d="M5 4h.01M12 4h.01M19 4h.01M5 10h.01M12 10h.01M19 10h.01M5 16h.01M12 16h.01M19 16h.01M12 21h.01" strokeWidth={strokeWidth + 2} />
      )}
      {name === 'arrow' && <Path {...p} d="M5 12h14M13 6l6 6-6 6" />}
      {name === 'search' && (
        <>
          <Circle {...p} cx={11} cy={11} r={7} />
          <Path {...p} d="M20 20l-4-4" />
        </>
      )}
      {name === 'image' && (
        <>
          <Rect {...p} x={3} y={4} width={18} height={16} rx={2} />
          <Circle {...p} cx={9} cy={10} r={2} />
          <Path {...p} d="M21 16l-5-5-9 9" />
        </>
      )}
      {name === 'keyboard' && (
        <>
          <Rect {...p} x={2} y={6} width={20} height={12} rx={2} />
          <Path {...p} d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </>
      )}
    </Svg>
  );
}
