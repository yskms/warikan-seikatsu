import { useColorScheme } from 'react-native';

import { colorsByScheme, type ThemeColors } from '../src/theme/colors.ts';

/** 端末のライト・ダークに合わせた色。取れないときはライト。 */
export function useColors(): ThemeColors {
  return useColorScheme() === 'dark' ? colorsByScheme.dark : colorsByScheme.light;
}
