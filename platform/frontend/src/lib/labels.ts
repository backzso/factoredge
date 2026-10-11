import type {
  HealthStatus,
  LineState,
  Protocol,
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
  ENGINEER: 'Mühendis',
  VIEWER: 'İzleyici',
};

export const ROLE_OPTIONS = (['ADMIN', 'ENGINEER', 'VIEWER'] as const).map((role) => ({
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

/** Rows of the register map in the device form, with a short unit note. */
export const REGISTER_SIGNAL: Record<Signal, { label: string; unit: string }> = {
  productionCount: { label: 'Üretim adedi', unit: 'adet' },
  motorTempC: { label: 'Motor sıcaklığı', unit: '°C' },
  motorCurrentA: { label: 'Motor akımı', unit: 'A' },
  scrapCount: { label: 'Fire adedi', unit: 'adet' },
  state: { label: 'Bant durumu', unit: '0 durdu · 1 çalışıyor · 2 arıza' },
};
