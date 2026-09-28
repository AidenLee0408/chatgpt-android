import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, useTheme } from '../theme';

interface ToastApi {
  show: (message: string) => void;
}
const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (m: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(m);
      AccessibilityInfo.announceForAccessibility(m);
      Animated.timing(opacity, { toValue: 1, duration: t.motion.fast, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: t.motion.fast, useNativeDriver: true }).start(() => setMessage(null));
      }, 2600);
    },
    [opacity, t.motion.fast],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 72, opacity, alignItems: 'center' }}
        >
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: t.color.text.primary,
              borderRadius: t.radius.button,
              paddingHorizontal: 16,
              paddingVertical: 12,
              maxWidth: 480,
            }}
          >
            <Text variant="body" tone="inverse">
              {message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}
