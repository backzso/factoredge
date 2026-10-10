import type { QueryClient } from '@tanstack/react-query';
import { HISTORY_MINUTES, qk } from '../api/queryKeys';
import type { Device, LatestReadings, LiveEvent, ReadingDto } from '../api/types';
import {
  appendReading,
  applySnapshotToDevices,
  applySnapshotToLatest,
  applyStatusToDevices,
  applyTelemetryToDevices,
  applyTelemetryToLatest,
  type DevicesUpdate,
  removeDeviceFromDevices,
  removeDeviceFromLatest,
} from './cacheReducers';

/** Writes one live event into the query cache (thin glue over the pure reducers). */
export function applyLiveEvent(
  queryClient: QueryClient,
  event: LiveEvent,
  now: number,
): void {
  switch (event.type) {
    case 'snapshot': {
      updateDevices(queryClient, (devices) =>
        applySnapshotToDevices(devices, event),
      );
      queryClient.setQueryData<LatestReadings>(qk.latest, (latest) =>
        applySnapshotToLatest(latest, event),
      );
      // After a reconnect the history has a gap; reload what is on screen.
      void queryClient.invalidateQueries({ queryKey: qk.allReadings });
      return;
    }
    case 'telemetry': {
      const { deviceId, reading } = event.data;
      queryClient.setQueryData<LatestReadings>(qk.latest, (latest) =>
        applyTelemetryToLatest(latest, event),
      );
      updateDevices(queryClient, (devices) =>
        applyTelemetryToDevices(devices, event),
      );
      const readingsKey = qk.readings(deviceId, HISTORY_MINUTES);
      if (queryClient.getQueryData(readingsKey) !== undefined) {
        queryClient.setQueryData<ReadingDto[]>(readingsKey, (readings) =>
          appendReading(readings, reading, now, HISTORY_MINUTES),
        );
      }
      return;
    }
    case 'status': {
      updateDevices(queryClient, (devices) =>
        applyStatusToDevices(devices, event),
      );
      return;
    }
    case 'device-removed': {
      queryClient.setQueryData<Device[]>(qk.devices, (devices) =>
        removeDeviceFromDevices(devices, event),
      );
      queryClient.setQueryData<LatestReadings>(qk.latest, (latest) =>
        removeDeviceFromLatest(latest, event),
      );
      queryClient.removeQueries({
        queryKey: qk.deviceReadings(event.data.deviceId),
      });
      return;
    }
    case 'heartbeat':
      return;
  }
}

function updateDevices(
  queryClient: QueryClient,
  reduce: (devices: Device[] | undefined) => DevicesUpdate,
): void {
  let unknown = false;
  queryClient.setQueryData<Device[]>(qk.devices, (devices) => {
    const result = reduce(devices);
    unknown = result.unknown;
    return result.devices;
  });
  if (unknown) {
    void queryClient.invalidateQueries({ queryKey: qk.devices });
  }
}
