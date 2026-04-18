import { memo, useState } from 'react';
import { Image, View, StyleSheet, type ImageProps, type ViewStyle } from 'react-native';
import { Camera } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';

/**
 * SafeImage — Image с fallback-иконкой при ошибке загрузки (404, сеть).
 *
 * Default Image компонент при ошибке показывает пустой квадрат — юзер
 * думает что контент сломан. SafeImage ловит onError и показывает
 * нейтральную Camera-иконку на Colors.surface2 фоне.
 *
 * Использовать везде где src = user-uploaded или external URL
 * (profile photo, stone photo, chat photo, leaderboard avatar).
 */
type Props = Omit<ImageProps, 'onError'> & {
  fallbackIconSize?: number;
  containerStyle?: ViewStyle;
};

export const SafeImage = memo(function SafeImage({
  source,
  style,
  fallbackIconSize = 24,
  containerStyle,
  ...rest
}: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View
        style={[
          styles.fallback,
          (style as ViewStyle),
          containerStyle,
        ]}
      >
        <Camera
          size={fallbackIconSize}
          color={Colors.text2}
          weight="regular"
        />
      </View>
    );
  }

  return (
    <Image
      {...rest}
      source={source}
      style={style}
      onError={() => setFailed(true)}
    />
  );
});

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
