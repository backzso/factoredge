import type { QueryClient } from '@tanstack/react-query';
import { HISTORY_MINUTES, qk, RECENT_EVENTS_LIMIT } from '../api/queryKeys';
import type {
  ActiveAlarm,
  Device,
  EventDto,
  LatestReadings,
  LiveEvent,
  ReadingDto,
} from '../api/types';
import { notifyAlarm } from '../components/notify';
import { alarmNotice } from './alarms';
import {
  appendReading,
  applyAlarmToDevices,
  applySnapshotToDevices,
  applySnapshotToLatest,
  applyStatusToDevices,
  applyTelemetryToDevices,
  applyTelemetryToLatest,
  type DevicesUpdate,
  removeDeviceFromDevices,
  removeDeviceFromLatest,
} from './cacheReducers';
import { type EventPages, prependEventToPages, prependRecent } from './eventReducers';

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
      // After a reconnect the history and the event log have a gap; reload
      // what is on screen.
      void queryClient.invalidateQueries({ queryKey: qk.allReadings });
      void queryClient.invalidateQueries({ queryKey: qk.allEvents });
      return;
    }
    case 'telemetry': {
      const { deviceId, reading, alarm } = event.data;
      const before = findDevice(queryClient, deviceId);
      // Reading and alarm in one step: no render can fall between them.
      queryClient.setQueryData<LatestReadings>(qk.latest, (latest) =>
        applyTelemetryToLatest(latest, event),
      );
      updateDevices(queryClient, (devices) =>
        applyTelemetryToDevices(devices, event),
      );
      notifyIfRaised(before, alarm);
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
      // Its events stay but lose their device id (shown as deleted): reload them.
      void queryClient.invalidateQueries({ queryKey: qk.allEvents });
      return;
    }
    case 'alarm': {
      const before = findDevice(queryClient, event.data.deviceId);
      updateDevices(queryClient, (devices) => applyAlarmToDevices(devices, event));
      notifyIfRaised(before, event.data.alarm);
      return;
    }
    case 'event':
      prependToEventQueries(queryClient, event.data);
      return;
    case 'heartbeat':
      return;
  }
}

/** Every loaded event-log query: the events page per filter, and the dashboard list. */
function prependToEventQueries(queryClient: QueryClient, event: EventDto): void {
  for (const [key] of queryClient.getQueriesData({ queryKey: qk.allEvents })) {
    if (key[1] === 'recent') {
      queryClient.setQueryData<EventDto[]>(key, (list) =>
        prependRecent(list, event, RECENT_EVENTS_LIMIT),
      );
    } else if (key[1] === 'list') {
      const filter = key[2] === 'all' ? null : String(key[2]);
      queryClient.setQueryData<EventPages>(key, (data) =>
        prependEventToPages(data, event, filter),
      );
    }
  }
}

function findDevice(queryClient: QueryClient, deviceId: string): Device | undefined {
  return queryClient.getQueryData<Device[]>(qk.devices)?.find((d) => d.id === deviceId);
}

/** One notification per newly raised alarm (see alarmNotice). */
function notifyIfRaised(before: Device | undefined, alarm: ActiveAlarm | null): void {
  const notice = alarmNotice(before?.name, before?.alarm, alarm);
  if (notice) notifyAlarm(notice.title, notice.message);
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
