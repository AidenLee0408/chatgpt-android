import { Feather } from '@expo/vector-icons';
import { View } from 'react-native';
import type { Persona } from '../api/types';
import { Text, useTheme } from '../theme';
import { Card } from './Card';
import { PersonaAvatar } from './PersonaAvatar';

export type PersonaCardState = 'default' | 'archived' | 'selected';

export interface PersonaCardProps {
  persona: Pick<Persona, 'id' | 'name' | 'icon' | 'color' | 'description' | 'fact_count' | 'connection_count' | 'archived'>;
  state?: PersonaCardState;
  /** Overrides persona.connection_count (e.g. computed from /connections). */
  connectionCount?: number;
  onPress?: () => void;
}

export function PersonaCard({ persona, state, connectionCount, onPress }: PersonaCardProps) {
  const t = useTheme();
  const s: PersonaCardState = state ?? (persona.archived ? 'archived' : 'default');
  const conn = connectionCount ?? persona.connection_count ?? 0;
  const facts = persona.fact_count;
  const a11y = [
    persona.name,
    s === 'archived' ? '보관됨' : null,
    s === 'selected' ? '선택됨' : null,
    facts != null ? `팩트 ${facts}개` : null,
    conn > 0 ? `AI ${conn}곳 연결` : '연결된 AI 없음',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Card
      onPress={onPress}
      selected={s === 'selected'}
      accessibilityLabel={a11y}
      style={{ flex: 1, gap: 12, opacity: s === 'archived' ? 0.6 : 1 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <PersonaAvatar id={persona.id} icon={persona.icon} color={persona.color} />
        {s === 'selected' ? <Feather name="check-circle" size={20} color={t.color.brand.primary} /> : null}
        {s === 'archived' ? <Feather name="archive" size={18} color={t.color.text.secondary} /> : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="headline" numberOfLines={1}>
          {persona.name}
        </Text>
        {persona.description ? (
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {persona.description}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <Feather name="link-2" size={12} color={t.color.text.secondary} />
        <Text variant="label" tone="secondary">
          {conn > 0 ? `AI ${conn}곳` : '연결 없음'}
          {facts != null ? ` · 팩트 ${facts}` : ''}
          {s === 'archived' ? ' · 보관됨' : ''}
        </Text>
      </View>
    </Card>
  );
}
