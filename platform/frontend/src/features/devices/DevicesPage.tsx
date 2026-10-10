import { Button, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCan } from '../../api/auth';
import {
  deviceAddress,
  useDeleteDevice,
  useDevices,
  useLatestReadings,
  useTemplates,
} from '../../api/devices';
import type { Device } from '../../api/types';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { HealthBadge, ProtocolBadge } from '../../components/badges';
import { notifyError, notifySuccess } from '../../components/notify';
import { PageLoader } from '../../components/PageLoader';
import { QueryError } from '../../components/QueryError';
import { RelativeTime } from '../../components/RelativeTime';
import { DeviceFormModal, type DeviceFormTarget } from './DeviceFormModal';

export function DevicesPage() {
  const devices = useDevices();
  const { data: latest } = useLatestReadings();
  const canManage = useCan('manageDevices');
  const templates = useTemplates();
  const remove = useDeleteDevice();
  const [params, setParams] = useSearchParams();

  const [formTarget, setFormTarget] = useState<DeviceFormTarget | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [toDelete, setToDelete] = useState<Device | null>(null);

  const openCreate = () => {
    if (!templates.data) return;
    setFormKey((k) => k + 1);
    setFormTarget({ mode: 'create', templates: templates.data });
  };
  const openEdit = (device: Device) => {
    setFormKey((k) => k + 1);
    setFormTarget({ mode: 'edit', device });
  };

  // "Cihaz ekle" link from the empty dashboard: /devices?new=1
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew || !templates.data) return;
    if (canManage) {
      setFormKey((k) => k + 1);
      setFormTarget({ mode: 'create', templates: templates.data });
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsNew, templates.data, canManage, setParams]);

  const confirmDelete = () => {
    if (!toDelete) return;
    const { id, name } = toDelete;
    remove.mutate(id, {
      onSuccess: () => {
        notifySuccess(`"${name}" silindi.`);
        setToDelete(null);
      },
      onError: (error) => {
        notifyError(error);
        setToDelete(null);
      },
    });
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Cihazlar</Title>
        {canManage && (
          <Button onClick={openCreate} loading={templates.isPending} disabled={!templates.data}>
            Cihaz ekle
          </Button>
        )}
      </Group>

      {devices.isPending ? (
        <PageLoader />
      ) : devices.isError ? (
        <QueryError error={devices.error} onRetry={() => void devices.refetch()} />
      ) : devices.data.length === 0 ? (
        <EmptyState title="Henüz cihaz yok">
          {canManage ? '"Cihaz ekle" ile ilk bandı tanımlayın.' : 'Bir yönetici cihaz eklediğinde burada görünecek.'}
        </EmptyState>
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ad</Table.Th>
                <Table.Th>Protokol</Table.Th>
                <Table.Th>Adres</Table.Th>
                <Table.Th>Sağlık</Table.Th>
                <Table.Th>Son veri</Table.Th>
                <Table.Th>Son hata</Table.Th>
                <Table.Th>Etkin</Table.Th>
                {canManage && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {devices.data.map((device) => (
                <Table.Tr key={device.id}>
                  <Table.Td fw={500}>{device.name}</Table.Td>
                  <Table.Td>
                    <ProtocolBadge protocol={device.protocol} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {deviceAddress(device)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <HealthBadge status={device.health.status} />
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={device.health.lastSeenAt ?? latest?.[device.id]?.receivedAt} />
                  </Table.Td>
                  <Table.Td maw={260}>
                    {device.health.lastError ? (
                      <Tooltip label={device.health.lastError} multiline maw={400} withArrow>
                        <Text size="sm" c="red" truncate>
                          {device.health.lastError}
                        </Text>
                      </Tooltip>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={device.enabled ? undefined : 'dimmed'}>
                      {device.enabled ? 'Evet' : 'Hayır'}
                    </Text>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap" justify="flex-end">
                        <Button size="xs" variant="default" onClick={() => openEdit(device)}>
                          Düzenle
                        </Button>
                        <Button size="xs" variant="light" color="red" onClick={() => setToDelete(device)}>
                          Sil
                        </Button>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {formTarget && <DeviceFormModal key={formKey} target={formTarget} onClose={() => setFormTarget(null)} />}

      <ConfirmModal
        opened={toDelete !== null}
        title="Cihazı sil"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      >
        <b>{toDelete?.name}</b> silinecek. Cihazın tüm okuma geçmişi de silinir. Bu işlem geri alınamaz.
      </ConfirmModal>
    </Stack>
  );
}
