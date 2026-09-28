import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { Connection, Persona } from '../../api/types';
import { BottomSheet, Button, Checkbox, ChipGroup, InlineBanner } from '../../components';
import { Text } from '../../theme';
import { isWidening, type ScopeSensitivity } from './format';

export interface ScopeValue {
  persona_ids: string[];
  max_sensitivity: ScopeSensitivity;
}

/** 범위 선택 바텀시트: persona multi-select + max sensitivity. */
export function ScopeSheet({
  visible,
  connection,
  personas,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  connection: Connection;
  personas: Persona[];
  saving: boolean;
  onClose: () => void;
  onSave: (v: ScopeValue, widening: boolean) => void;
}) {
  const [ids, setIds] = useState<string[]>(connection.persona_ids);
  const [max, setMax] = useState<ScopeSensitivity>(connection.max_sensitivity);
  useEffect(() => {
    if (visible) {
      setIds(connection.persona_ids);
      setMax(connection.max_sensitivity);
    }
  }, [visible, connection.persona_ids, connection.max_sensitivity]);

  const next = { persona_ids: ids, max_sensitivity: max };
  const widening = isWidening(connection, next);
  const unchanged = !widening && !isWidening(next, connection);
  const toggle = (id: string, on: boolean) => setIds((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="범위 선택">
      <Text variant="body" tone="secondary">
        {connection.client_name}가 볼 수 있는 페르소나를 골라요. 비공개 정보는 어떤 경우에도 전달되지 않아요.
      </Text>
      <View>
        {personas.length === 0 ? (
          <Text variant="caption" tone="secondary">
            아직 페르소나가 없어요.
          </Text>
        ) : (
          personas.map((p) => (
            <Checkbox key={p.id} label={p.name} description={p.description || undefined} checked={ids.includes(p.id)} onChange={(v) => toggle(p.id, v)} />
          ))
        )}
      </View>
      <View style={{ gap: 8 }}>
        <Text variant="label" tone="secondary">
          최대 등급
        </Text>
        <ChipGroup<ScopeSensitivity>
          label="최대 등급"
          value={max}
          onChange={setMax}
          options={[
            { value: 'normal', label: '일반만' },
            { value: 'sensitive', label: '민감 포함' },
          ]}
        />
      </View>
      {widening ? <InlineBanner tone="warning" message="범위를 넓히려면 본인 확인이 필요해요." /> : null}
      <Button
        label={ids.length === 0 ? '페르소나를 1개 이상 선택해 주세요' : widening ? '본인 확인 후 범위 넓히기' : '범위 저장'}
        disabled={unchanged || ids.length === 0}
        loading={saving}
        onPress={() => onSave(next, widening)}
      />
    </BottomSheet>
  );
}
