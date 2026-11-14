import { Text } from 'react-native';

import { splitNumbers } from '../lib/digits';
import { fonts, numFonts } from '../theme/tokens';

type Weight = keyof typeof fonts;

/**
 * The one place numbers get their font: Noto Sans Bengali for the digits (and ৳) of a string,
 * the surrounding text keeps the font it is in (Hind Siliguri). Used inside <Text>/<Txt>
 * (Txt does it for every string child, so prices, quantities, cash and history all get it).
 */
export function Num({ children, weight = 'semibold' }: { children: string; weight?: Weight }) {
  const runs = splitNumbers(children);
  if (!runs.some((r) => r.num)) return <>{children}</>;
  return (
    <>
      {runs.map((r, i) =>
        r.num ? (
          <Text key={i} style={{ fontFamily: numFonts[weight] }}>
            {r.text}
          </Text>
        ) : (
          r.text
        ),
      )}
    </>
  );
}
