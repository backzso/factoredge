import type {
  HealthStatus,
  LineState,
  Protocol,
  RegisterType,
  Role,
  Signal,
} from '../api/types';

interface Labeled {
  label: string;
  color: string;
}

export const HEALTH: Record<HealthStatus, Labeled> = {
  ONLINE: { label: 'Çevrimiçi', color: 'green' },
  STALE: { label: 'Veri yok', color: 'yellow' },
  OFFLINE: { label: 'Bağlantı yok', color: 'red' },
  CONNECTING: { label: 'Bağlanıyor', color: 'blue' },
  DISABLED: { label: 'Devre dışı', color: 'gray' },
};

export const LINE_STATE: Record<LineState, Labeled> = {
  RUNNING: { label: 'Çalışıyor', color: 'green' },
  STOPPED: { label: 'Durdu', color: 'gray' },
  FAULT: { label: 'Arıza', color: 'red' },
};

export function lineStateLabel(state: LineState): string {
  return LINE_STATE[state].label;
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Yönetici',
  VIEWER: 'İzleyici',
};

export const ROLE_OPTIONS = (['ADMIN', 'VIEWER'] as const).map((role) => ({
  value: role,
  label: ROLE_LABEL[role],
}));

export const PROTOCOL: Record<Protocol, Labeled> = {
  MODBUS: { label: 'Modbus TCP', color: 'indigo' },
  MQTT: { label: 'MQTT', color: 'grape' },
};

export const SIGNAL_LABEL: Record<Signal, string> = {
  productionCount: 'Üretim',
  motorTempC: 'Sıcaklık',
  motorCurrentA: 'Akım',
  scrapCount: 'Fire',
  state: 'Bant durumu',
};

/** Order used in selects and on the dashboard card. */
export const SIGNAL_ORDER: Signal[] = [
  'productionCount',
  'motorTempC',
  'motorCurrentA',
  'scrapCount',
  'state',
];

export const REGISTER_TYPE_LABEL: Record<RegisterType, string> = {
  uint16: 'uint16',
  int16: 'int16',
  uint32: 'uint32 (2 register)',
  float32: 'float32 (2 register)',
};
