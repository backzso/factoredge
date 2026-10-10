import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyLiveEvent } from '../live/applyLiveEvent';
import { api } from './client';
import { HISTORY_MINUTES, qk } from './queryKeys';
import type {
  Device,
  DeviceTemplates,
  LatestReadings,
  ModbusConfig,
  MqttConfig,
  Protocol,
  ReadingDto,
} from './types';

export function useDevices() {
  return useQuery({
    queryKey: qk.devices,
    queryFn: () => api<Device[]>('/devices'),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates,
    queryFn: () => api<DeviceTemplates>('/devices/templates'),
    staleTime: Infinity,
  });
}

/**
 * Last reading per device. Filled only by the live stream (snapshot +
 * telemetry); the query function just keeps what is there.
 */
export function useLatestReadings() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: qk.latest,
    queryFn: () => queryClient.getQueryData<LatestReadings>(qk.latest) ?? {},
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Readings of the last hour, oldest first; extended live by the stream. */
export function useReadings(deviceId: string | null) {
  return useQuery({
    queryKey: qk.readings(deviceId ?? '', HISTORY_MINUTES),
    queryFn: () =>
      api<ReadingDto[]>(
        `/devices/${encodeURIComponent(deviceId ?? '')}/readings?minutes=${HISTORY_MINUTES}`,
      ),
    enabled: deviceId !== null,
    staleTime: Infinity,
  });
}

export type DeviceInput =
  | { name: string; protocol: 'MODBUS'; enabled: boolean; config: ModbusConfig }
  | { name: string; protocol: 'MQTT'; enabled: boolean; config: MqttConfig };

/** Protocol cannot be changed after creation. */
export type DeviceUpdate = Omit<DeviceInput, 'protocol'> & { protocol?: never };

export function useCreateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeviceInput) =>
      api<Device>('/devices', { method: 'POST', body: input }),
    onSuccess: (device) => {
      queryClient.setQueryData<Device[]>(qk.devices, (devices) =>
        devices && !devices.some((d) => d.id === device.id)
          ? [...devices, device]
          : devices,
      );
    },
  });
}

export function useUpdateDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: DeviceUpdate }) =>
      api<Device>(`/devices/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: update,
      }),
    onSuccess: (device) => {
      queryClient.setQueryData<Device[]>(qk.devices, (devices) =>
        devices?.map((d) => (d.id === device.id ? device : d)),
      );
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // Same cache path as the stream's device-removed event (which also arrives).
    onSuccess: (_result, id) => {
      applyLiveEvent(
        queryClient,
        { type: 'device-removed', data: { deviceId: id } },
        Date.now(),
      );
    },
  });
}

export function deviceAddress(device: Device): string {
  return device.protocol === 'MODBUS'
    ? `${device.config.host}:${device.config.port}`
    : `${device.config.brokerUrl} · ${device.config.topicPrefix}`;
}

export const PROTOCOLS: Protocol[] = ['MODBUS', 'MQTT'];
