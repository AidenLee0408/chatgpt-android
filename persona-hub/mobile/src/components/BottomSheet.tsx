import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, useTheme } from '../theme';
import { Button } from './Button';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="시트 닫기"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: t.color.scrim }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: t.color.bg.surface,
            borderTopLeftRadius: t.radius.sheet,
            borderTopRightRadius: t.radius.sheet,
            borderWidth: 1,
            borderColor: t.color.border,
            paddingHorizontal: t.layout.screenPadding,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            gap: 16,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.color.border }} />
          {title ? (
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body?: string;
  /** Result-describing label, e.g. "팩트 삭제", "연결 끊기". */
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation sheet placed before every irreversible action. */
export function ConfirmSheet({ visible, title, body, confirmLabel, cancelLabel = '취소', danger = true, loading, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onCancel} title={title}>
      {body ? (
        <Text variant="body" tone="secondary">
          {body}
        </Text>
      ) : null}
      <View style={{ gap: 8 }}>
        <Button label={confirmLabel} variant={danger ? 'danger' : 'primary'} loading={loading} onPress={onConfirm} />
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} />
      </View>
    </BottomSheet>
  );
}
