import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Stroke icons from the design (24×24 viewBox, round caps). */
export type IconName =
  | 'cart' | 'box' | 'book' | 'speaker' | 'mic' | 'keyboard'
  | 'back' | 'plus' | 'minus' | 'check' | 'close' | 'cash' | 'play' | 'list';

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
      {name === 'keyboard' && (
        <>
          <Rect {...p} x={2} y={6} width={20} height={12} rx={2} />
          <Path {...p} d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
        </>
      )}
    </Svg>
  );
}
