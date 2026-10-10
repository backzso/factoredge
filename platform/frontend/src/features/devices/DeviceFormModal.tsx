import {
  Alert,
  Button,
  Divider,
  Group,
  List,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { isApiError } from '../../api/client';
import { useCreateDevice, useUpdateDevice } from '../../api/devices';
import { translateApiMessage } from '../../api/errors';
import type { Device, DeviceTemplates, Protocol } from '../../api/types';
import { notifyError, notifySuccess } from '../../components/notify';
import { issuesFromError, mapIssuesToForm } from '../../lib/issueMapping';
import { PROTOCOL } from '../../lib/labels';
import { RegisterMapTable } from './RegisterMapTable';
import {
  type DeviceFormValues,
  knownFieldPaths,
  toDeviceInput,
  validateDeviceForm,
  valuesFromDevice,
  valuesFromTemplates,
} from './deviceForm';

export type DeviceFormTarget = { mode: 'create'; templates: DeviceTemplates } | { mode: 'edit'; device: Device };

/** Mounted per opening (keyed by the caller), so the initial values are read once. */
export function DeviceFormModal({ target, onClose }: { target: DeviceFormTarget; onClose: () => void }) {
  const editing = target.mode === 'edit';
  const create = useCreateDevice();
  const update = useUpdateDevice();
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const form = useForm<DeviceFormValues>({
    initialValues: editing ? valuesFromDevice(target.device) : valuesFromTemplates(target.templates),
    validate: validateDeviceForm,
  });
  const { protocol } = form.values;

  const handleError = (error: unknown) => {
    if (!isApiError(error)) {
      notifyError(error);
      return;
    }
    if (error.status === 400) {
      const known = knownFieldPaths(protocol, form.values.config.registerMap.length);
      const mapped = mapIssuesToForm(issuesFromError(error, ['name', 'enabled', 'protocol', 'config']), (p) =>
        known.has(p),
      );
      form.setErrors(mapped.fieldErrors);
      setFormErrors(mapped.formErrors);
      return;
    }
    if (error.status === 409) {
      form.setFieldError('name', translateApiMessage(error.message));
      return;
    }
    notifyError(error);
  };

  const submit = form.onSubmit((values) => {
    setFormErrors([]);
    const input = toDeviceInput(values);
    if (target.mode === 'edit') {
      const { protocol: _protocol, ...rest } = input;
      update.mutate(
        { id: target.device.id, update: rest },
        {
          onSuccess: (device) => {
            notifySuccess(`"${device.name}" güncellendi.`);
            onClose();
          },
          onError: handleError,
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: (device) => {
          notifySuccess(`"${device.name}" eklendi.`);
          onClose();
        },
        onError: handleError,
      });
    }
  });

  const saving = create.isPending || update.isPending;

  return (
    <Modal
      opened
      onClose={onClose}
      title={editing ? 'Cihazı düzenle' : 'Cihaz ekle'}
      size={protocol === 'MODBUS' ? 'xl' : 'lg'}
      closeOnClickOutside={!saving}
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          {formErrors.length > 0 && (
            <Alert color="red" title="Kaydedilemedi">
              <List size="sm">
                {formErrors.map((message, i) => (
                  <List.Item key={i}>{message}</List.Item>
                ))}
              </List>
            </Alert>
          )}

          <TextInput label="Ad" required {...form.getInputProps('name')} />
          <div>
            <Text size="sm" fw={500} mb={4}>
              Protokol
            </Text>
            <SegmentedControl
              data={(['MODBUS', 'MQTT'] as Protocol[]).map((p) => ({ value: p, label: PROTOCOL[p].label }))}
              disabled={editing}
              {...form.getInputProps('protocol')}
            />
            {editing && (
              <Text size="xs" c="dimmed" mt={4}>
                Protokol sonradan değiştirilemez; gerekirse cihazı silip yeniden ekleyin.
              </Text>
            )}
          </div>
          <Switch label="Etkin" {...form.getInputProps('enabled', { type: 'checkbox' })} />

          <Divider label="Bağlantı" labelPosition="left" />

          {protocol === 'MODBUS' ? (
            <>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <TextInput label="Host" placeholder="192.168.1.10" required {...form.getInputProps('config.host')} />
                <NumberInput
                  label="Port"
                  min={1}
                  max={65535}
                  allowDecimal={false}
                  thousandSeparator=""
                  required
                  {...form.getInputProps('config.port')}
                />
                <NumberInput
                  label="Unit ID"
                  min={1}
                  max={247}
                  allowDecimal={false}
                  required
                  {...form.getInputProps('config.unitId')}
                />
                <NumberInput
                  label="Okuma aralığı (ms)"
                  min={200}
                  allowDecimal={false}
                  required
                  {...form.getInputProps('config.pollIntervalMs')}
                />
                <NumberInput
                  label="Zaman aşımı (ms)"
                  min={100}
                  allowDecimal={false}
                  required
                  {...form.getInputProps('config.timeoutMs')}
                />
              </SimpleGrid>
              <RegisterMapTable form={form} />
            </>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Broker adresi"
                placeholder="mqtt://192.168.1.10:1883"
                required
                {...form.getInputProps('config.brokerUrl')}
              />
              <TextInput
                label="Topic öneki"
                placeholder="factory/line2"
                required
                {...form.getInputProps('config.topicPrefix')}
              />
              <NumberInput
                label="Veri yok sayılma süresi (ms)"
                min={500}
                allowDecimal={false}
                required
                {...form.getInputProps('config.staleAfterMs')}
              />
            </SimpleGrid>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={saving}>
              Vazgeç
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Kaydet' : 'Ekle'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
