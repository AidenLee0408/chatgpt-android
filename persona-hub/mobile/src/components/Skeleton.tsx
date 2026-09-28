import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View, type DimensionValue } from 'react-native';
import { useTheme } from '../theme';

export function Skeleton({ width = '100%', height = 16, radius = 8 }: { width?: DimensionValue; height?: number; radius?: number }) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (reduce || cancelled) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);
  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: t.color.skeleton, opacity }} />;
}

/** Card-shaped placeholder list for loading states. */
export function SkeletonList({ rows = 3, grid }: { rows?: number; grid?: boolean }) {
  const t = useTheme();
  return (
    <View accessibilityLabel="불러오는 중" accessibilityRole="progressbar" style={{ gap: 12, flexDirection: grid ? 'row' : 'column', flexWrap: 'wrap' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={{
            width: grid ? '47%' : '100%',
            padding: 16,
            gap: 10,
            borderRadius: t.radius.card,
            borderWidth: 1,
            borderColor: t.color.border,
            backgroundColor: t.color.bg.surface,
          }}
        >
          <Skeleton width={40} height={40} radius={16} />
          <Skeleton width="70%" />
          <Skeleton width="45%" height={12} />
        </View>
      ))}
    </View>
  );
}
