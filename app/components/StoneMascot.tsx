import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Flower, Leaf, Crown, Heart } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';

export type MascotVariant =
  | 'happy'       // обычный smile + круглые глаза
  | 'sleeping'   // закрытые глаза → полосочки
  | 'wink'       // одна полосочка, другой глаз круглый
  | 'sparkle'    // + sparkles вокруг (always shown)
  | 'blush'      // happy + большой розовый blush
  | 'laughing'   // закрытые arc-eyes + широкий рот
  | 'surprised'  // круглые глаза + O-рот
  | 'heart';     // глаза-сердечки (влюблённый look)

export type MascotShape =
  | 'pebble'
  | 'round'
  | 'egg'
  | 'long'
  | 'bumpy'
  | 'tall';

export type MascotDecor =
  | 'none'
  | 'flower'
  | 'leaf'
  | 'cat-ears'
  | 'glasses'
  | 'crown'
  | 'headband'  // розовый бант сверху
  | 'halo'      // золотое кольцо над головой
  | 'heart-hat'; // красное сердечко сверху

type ShapeConfig = {
  bodyWidth: number;
  bodyHeight: number;
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
  rotation: number;
};

// All numbers are multipliers of `size`. Each shape gives the mascot a
// completely different silhouette. Face elements stay centered inside the
// body so they look natural in any shape.
const SHAPES: Record<MascotShape, ShapeConfig> = {
  // Original asymmetric pebble — wider on top-right, flatter on bottom-right
  pebble: {
    bodyWidth: 0.86,
    bodyHeight: 0.64,
    borderTopLeftRadius: 0.32,
    borderTopRightRadius: 0.4,
    borderBottomLeftRadius: 0.22,
    borderBottomRightRadius: 0.18,
    rotation: -2,
  },
  // Almost-round river stone — slightly squashed on one side
  round: {
    bodyWidth: 0.78,
    bodyHeight: 0.72,
    borderTopLeftRadius: 0.42,
    borderTopRightRadius: 0.36,
    borderBottomLeftRadius: 0.34,
    borderBottomRightRadius: 0.4,
    rotation: -3,
  },
  // Tall egg — narrow shoulders, wider bottom
  egg: {
    bodyWidth: 0.64,
    bodyHeight: 0.86,
    borderTopLeftRadius: 0.36,
    borderTopRightRadius: 0.34,
    borderBottomLeftRadius: 0.28,
    borderBottomRightRadius: 0.3,
    rotation: 4,
  },
  // Long flat skipping stone — pulled left, tail on right
  long: {
    bodyWidth: 0.94,
    bodyHeight: 0.46,
    borderTopLeftRadius: 0.28,
    borderTopRightRadius: 0.18,
    borderBottomLeftRadius: 0.22,
    borderBottomRightRadius: 0.12,
    rotation: -5,
  },
  // Bumpy lumpy character stone — strong asymmetry on opposite corners
  bumpy: {
    bodyWidth: 0.82,
    bodyHeight: 0.7,
    borderTopLeftRadius: 0.42,
    borderTopRightRadius: 0.22,
    borderBottomLeftRadius: 0.16,
    borderBottomRightRadius: 0.4,
    rotation: 6,
  },
  // Narrow tall pillar — almost rectangular but soft
  tall: {
    bodyWidth: 0.56,
    bodyHeight: 0.88,
    borderTopLeftRadius: 0.26,
    borderTopRightRadius: 0.32,
    borderBottomLeftRadius: 0.18,
    borderBottomRightRadius: 0.22,
    rotation: 5,
  },
};

type Props = {
  size?: number;
  color?: string;
  variant?: MascotVariant;
  shape?: MascotShape;
  decor?: MascotDecor;
  showSparkles?: boolean;
};

/**
 * Cute stone mascot for Stobi. Drawn with React Native primitives —
 * no SVG / no image assets, so it scales freely. Used on onboarding,
 * profile, helper hints, etc. The mascot doubles as the user's stone-avatar.
 */
// Memo: mascot — тяжёлый View с 30+ StyleSheet subcomponents,
// ре-рендеры при одинаковых props → лишний CPU. memo() даёт ~30-40%
// экономии в профиле / celebration / welcome quest где маскот
// рендерится несколько раз одновременно.
export const StoneMascot = memo(function StoneMascot({
  size = 180,
  color = Colors.mascot,
  variant = 'happy',
  shape = 'pebble',
  decor = 'none',
  showSparkles = true,
}: Props) {
  const s = size / 180; // scale factor — design at 180px
  const dark = '#1A1A2E';
  const eyeOpen = variant === 'sleeping' || variant === 'laughing'; // закрытые arc-eyes
  const winkLeft = variant === 'wink';
  const surprised = variant === 'surprised';
  const laughing = variant === 'laughing';
  const blush = variant === 'blush';
  const heart = variant === 'heart';
  // Variant 'sparkle' форсит sparkles независимо от prop — иначе на preview без эффекта.
  const effectiveSparkles = showSparkles || variant === 'sparkle';
  const cfg = SHAPES[shape];

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Sparkles around the stone */}
      {effectiveSparkles && (
        <>
          <Text
            style={[
              styles.sparkle,
              {
                top: 8 * s,
                left: 14 * s,
                fontSize: 26 * s,
                color: Colors.yellow,
              },
            ]}
          >
            ✦
          </Text>
          <Text
            style={[
              styles.sparkle,
              {
                top: 22 * s,
                right: 8 * s,
                fontSize: 18 * s,
                color: Colors.yellow,
              },
            ]}
          >
            ✦
          </Text>
          <Text
            style={[
              styles.sparkle,
              {
                bottom: 24 * s,
                left: 4 * s,
                fontSize: 14 * s,
                color: '#FFFFFF',
              },
            ]}
          >
            •
          </Text>
        </>
      )}

      {/* Stone body — silhouette comes from the shape config */}
      <View
        style={{
          width: size * cfg.bodyWidth,
          height: size * cfg.bodyHeight,
          backgroundColor: color,
          borderTopLeftRadius: size * cfg.borderTopLeftRadius,
          borderTopRightRadius: size * cfg.borderTopRightRadius,
          borderBottomLeftRadius: size * cfg.borderBottomLeftRadius,
          borderBottomRightRadius: size * cfg.borderBottomRightRadius,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: `${cfg.rotation}deg` }],
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 * s },
          shadowOpacity: 0.22,
          shadowRadius: 14 * s,
          elevation: 10,
        }}
      >
        {/* Highlight blob — adds 3D feel */}
        <View
          style={{
            position: 'absolute',
            top: size * 0.07,
            left: size * 0.13,
            width: size * 0.2,
            height: size * 0.08,
            borderRadius: size * 0.05,
            backgroundColor: 'rgba(255,255,255,0.35)',
            transform: [{ rotate: '-12deg' }],
          }}
        />

        {/* Face wrap — keeps eyes + smile centered as a group, counter-rotated to stay upright */}
        <View
          style={{
            alignItems: 'center',
            marginTop: size * 0.02,
            transform: [{ rotate: `${-cfg.rotation}deg` }],
          }}
        >
          {/* Eyes row */}
          <View
            style={{
              flexDirection: 'row',
              gap: size * 0.13,
            }}
          >
            {/* Left eye */}
            {heart ? (
              <Heart
                size={size * 0.11}
                color="#EF4444"
                weight="fill"
              />
            ) : winkLeft || eyeOpen ? (
              <View
                style={{
                  width: size * 0.07,
                  height: size * 0.018,
                  backgroundColor: dark,
                  borderRadius: size * 0.04,
                  marginTop: size * 0.04,
                }}
              />
            ) : (
              <View
                style={{
                  width: size * (surprised ? 0.09 : 0.065),
                  height: size * (surprised ? 0.11 : 0.085),
                  backgroundColor: dark,
                  borderRadius: size * 0.06,
                }}
              />
            )}

            {/* Right eye */}
            {heart ? (
              <Heart
                size={size * 0.11}
                color="#EF4444"
                weight="fill"
              />
            ) : eyeOpen ? (
              <View
                style={{
                  width: size * 0.07,
                  height: size * 0.018,
                  backgroundColor: dark,
                  borderRadius: size * 0.04,
                  marginTop: size * 0.04,
                }}
              />
            ) : (
              <View
                style={{
                  width: size * (surprised ? 0.09 : 0.065),
                  height: size * (surprised ? 0.11 : 0.085),
                  backgroundColor: dark,
                  borderRadius: size * 0.06,
                }}
              />
            )}
          </View>

          {/* Mouth — варианты: smile / laughing (big open U) / surprised (O) */}
          {surprised ? (
            // Small O-shape — круглый rotten рот
            <View
              style={{
                width: size * 0.065,
                height: size * 0.07,
                borderRadius: size * 0.05,
                backgroundColor: dark,
                marginTop: size * 0.03,
              }}
            />
          ) : laughing ? (
            // Big open smile — широкий wide U
            <View
              style={{
                width: size * 0.18,
                height: size * 0.1,
                borderRadius: size * 0.1,
                backgroundColor: dark,
                marginTop: size * 0.028,
                overflow: 'hidden',
              }}
            >
              {/* Розовый язык внутри */}
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  alignSelf: 'center',
                  width: size * 0.09,
                  height: size * 0.05,
                  borderRadius: size * 0.05,
                  backgroundColor: Colors.blush,
                }}
              />
            </View>
          ) : (
            // Default U-smile
            <View
              style={{
                width: size * 0.13,
                height: size * 0.07,
                borderRadius: size * 0.07,
                borderWidth: size * 0.018,
                borderColor: 'transparent',
                borderBottomColor: dark,
                marginTop: size * 0.025,
              }}
            />
          )}
        </View>

        {/* Blush cheeks — bottom position scales with body height.
             Для variant='blush' щёки значительно крупнее и ярче —
             чтобы разница была видна даже на 60px preview-карточках. */}
        <View
          style={{
            position: 'absolute',
            bottom: size * cfg.bodyHeight * 0.2,
            flexDirection: 'row',
            gap: blush ? size * 0.22 : size * 0.34,
            transform: [{ rotate: `${-cfg.rotation}deg` }],
          }}
        >
          <View
            style={{
              width: size * (blush ? 0.16 : 0.075),
              height: size * (blush ? 0.1 : 0.045),
              borderRadius: size * 0.06,
              backgroundColor: blush ? '#F87171' : Colors.blush,
              opacity: blush ? 1 : 0.7,
            }}
          />
          <View
            style={{
              width: size * (blush ? 0.16 : 0.075),
              height: size * (blush ? 0.1 : 0.045),
              borderRadius: size * 0.06,
              backgroundColor: blush ? '#F87171' : Colors.blush,
              opacity: blush ? 1 : 0.7,
            }}
          />
        </View>
      </View>

      {/* Decoration overlay — positioned in the outer wrapper so it sits
          over (or next to) the rotated body without inheriting rotation. */}
      {decor === 'flower' && (
        <View
          style={{
            position: 'absolute',
            top: size * 0.04,
            right: size * 0.1,
            transform: [{ rotate: '15deg' }],
          }}
          pointerEvents="none"
        >
          <Flower size={size * 0.22} color="#F0ABFC" weight="fill" />
        </View>
      )}

      {decor === 'leaf' && (
        <View
          style={{
            position: 'absolute',
            top: size * 0.02,
            left: size * 0.08,
            transform: [{ rotate: '-25deg' }],
          }}
          pointerEvents="none"
        >
          <Leaf size={size * 0.22} color="#10B981" weight="fill" />
        </View>
      )}

      {decor === 'crown' && (
        <View
          style={{
            position: 'absolute',
            top: size * -0.02,
            alignSelf: 'center',
          }}
          pointerEvents="none"
        >
          <Crown size={size * 0.28} color="#FCD34D" weight="fill" />
        </View>
      )}

      {decor === 'cat-ears' && (
        <>
          {/* Left ear — triangle drawn with borders */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.04,
              left: size * 0.18,
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.07,
              borderRightWidth: size * 0.07,
              borderBottomWidth: size * 0.13,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
              transform: [{ rotate: '-18deg' }],
            }}
          />
          {/* Inner pink */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.09,
              left: size * 0.21,
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.035,
              borderRightWidth: size * 0.035,
              borderBottomWidth: size * 0.068,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: Colors.blush,
              opacity: 0.85,
              transform: [{ rotate: '-18deg' }],
            }}
          />

          {/* Right ear */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.04,
              right: size * 0.18,
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.07,
              borderRightWidth: size * 0.07,
              borderBottomWidth: size * 0.13,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
              transform: [{ rotate: '18deg' }],
            }}
          />
          {/* Inner pink */}
          <View
            style={{
              position: 'absolute',
              top: size * 0.09,
              right: size * 0.21,
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.035,
              borderRightWidth: size * 0.035,
              borderBottomWidth: size * 0.068,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: Colors.blush,
              opacity: 0.85,
              transform: [{ rotate: '18deg' }],
            }}
          />
        </>
      )}

      {decor === 'glasses' && (
        <View
          style={{
            position: 'absolute',
            top: size * 0.36,
            left: 0,
            right: 0,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: size * 0.02,
          }}
          pointerEvents="none"
        >
          {/* Left lens */}
          <View
            style={{
              width: size * 0.16,
              height: size * 0.16,
              borderRadius: size * 0.08,
              borderWidth: size * 0.018,
              borderColor: dark,
              backgroundColor: 'rgba(255,255,255,0.25)',
            }}
          />
          {/* Bridge */}
          <View
            style={{
              width: size * 0.025,
              height: size * 0.014,
              backgroundColor: dark,
            }}
          />
          {/* Right lens */}
          <View
            style={{
              width: size * 0.16,
              height: size * 0.16,
              borderRadius: size * 0.08,
              borderWidth: size * 0.018,
              borderColor: dark,
              backgroundColor: 'rgba(255,255,255,0.25)',
            }}
          />
        </View>
      )}

      {/* Headband — розовый bow сверху */}
      {decor === 'headband' && (
        <View
          style={{
            position: 'absolute',
            top: size * 0.0,
            alignSelf: 'center',
            width: size * 0.35,
            height: size * 0.15,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pointerEvents="none"
        >
          {/* Left bow loop */}
          <View
            style={{
              width: size * 0.12,
              height: size * 0.1,
              backgroundColor: '#F0ABFC',
              borderTopLeftRadius: size * 0.08,
              borderBottomLeftRadius: size * 0.05,
              borderBottomRightRadius: size * 0.02,
              transform: [{ rotate: '-15deg' }],
            }}
          />
          {/* Center knot */}
          <View
            style={{
              width: size * 0.05,
              height: size * 0.08,
              backgroundColor: '#DB2777',
              borderRadius: size * 0.02,
            }}
          />
          {/* Right bow loop */}
          <View
            style={{
              width: size * 0.12,
              height: size * 0.1,
              backgroundColor: '#F0ABFC',
              borderTopRightRadius: size * 0.08,
              borderBottomRightRadius: size * 0.05,
              borderBottomLeftRadius: size * 0.02,
              transform: [{ rotate: '15deg' }],
            }}
          />
        </View>
      )}

      {/* Halo — золотой ring над головой */}
      {decor === 'halo' && (
        <View
          style={{
            position: 'absolute',
            top: size * -0.04,
            alignSelf: 'center',
            width: size * 0.45,
            height: size * 0.1,
            borderRadius: size * 0.05,
            borderWidth: size * 0.024,
            borderColor: '#FCD34D',
            shadowColor: '#FCD34D',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.6,
            shadowRadius: size * 0.05,
            elevation: 6,
          }}
          pointerEvents="none"
        />
      )}

      {/* Heart hat — красное сердечко сверху */}
      {decor === 'heart-hat' && (
        <View
          style={{
            position: 'absolute',
            top: size * -0.02,
            alignSelf: 'center',
            width: size * 0.22,
            height: size * 0.2,
          }}
          pointerEvents="none"
        >
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size * 0.13,
              height: size * 0.13,
              borderRadius: size * 0.065,
              backgroundColor: '#EF4444',
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: size * 0.13,
              height: size * 0.13,
              borderRadius: size * 0.065,
              backgroundColor: '#EF4444',
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: size * 0.05,
              left: size * 0.015,
              width: size * 0.19,
              height: size * 0.13,
              backgroundColor: '#EF4444',
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      )}

      {/* Ground shadow under the stone */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.06,
          width: size * 0.5,
          height: size * 0.04,
          borderRadius: size * 0.04,
          backgroundColor: 'rgba(0,0,0,0.18)',
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  sparkle: {
    position: 'absolute',
    zIndex: 1,
    fontWeight: '900',
  },
});
