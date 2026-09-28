import type { AccessLog, Persona } from '../../api/types';
import { personaNames } from '../connections/format';

/** "Claude가 업무 페르소나를 읽었어요" — subject is always the concrete AI name. */
export function logSentence(log: AccessLog, personas: Persona[] | undefined): string {
  const ai = log.connection.client_name;
  const names = personaNames(log.persona_ids, personas);
  if (log.tool === 'list_personas' || names.length === 0) return `${ai}가 페르소나 목록을 확인했어요`;
  if (log.tool === 'search_facts') return `${ai}가 ${joinNames(names)} 페르소나에서 정보를 찾았어요`;
  return `${ai}가 ${joinNames(names)} 페르소나를 읽었어요`;
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join('·');
  return `${names.slice(0, 2).join('·')} 외 ${names.length - 2}개`;
}
