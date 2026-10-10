import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Input,
  List,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { isApiError } from '../../api/client';
import { type DeviceInput, useCreateDevice, useUpdateDevice } from '../../api/devices';
import { translateApiMessage } from '../../api/errors';
import type { Device, DeviceTemplates, Protocol } from '../../api/types';
import { notifyError, notifySuccess } from '../../components/notify';
import { issuesFromError, mapIssuesToForm } from '../../lib/issueMapping';
import { PROTOCOL } from '../../lib/labels';
import { RegisterMapTable } from './RegisterMapTable';
import {
  type DeviceFormValues,
  knownFieldPaths,
  toDeviceFormPath,
  toDeviceInput,
  validateDeviceForm,
  valuesFromDevice,
  valuesFromTemplates,
} from './deviceForm';

// Wide enough for the register table without sideways scrolling; capped by the
// viewport on small screens.
const MODAL_WIDTH = 880;

const BORDER = '1px solid var(--mantine-color-default-border)';

// Fixed header and footer, one scrolling body in between: the title and the
// Save/Cancel buttons stay on screen however tall the form gets.
const MODAL_STYLES = {
  content: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { position: 'static', borderBottom: BORDER },
  body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: 0 },
} as const;

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

  const handleError = (error: unknown, sent: DeviceInput) => {
    if (!isApiError(error)) {
      notifyError(error);
      return;
    }
    if (error.status === 400) {
      const known = knownFieldPaths(sent.protocol);
      const sentRegisters = sent.protocol === 'MODBUS' ? sent.config.registerMap : [];
      const mapped = mapIssuesToForm(
        issuesFromError(error, ['name', 'enabled', 'protocol', 'config']),
        (p) => known.has(p),
        (p) => toDeviceFormPath(p, sentRegisters),
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
          onError: (error) => handleError(error, input),
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: (device) => {
          notifySuccess(`"${device.name}" eklendi.`);
          onClose();
        },
        onError: (error) => handleError(error, input),
      });
    }
  });

  const saving = create.isPending || update.isPending;

  return (
    <Modal
      opened
      onClose={onClose}
      title={editing ? 'Cihazı düzenle' : 'Cihaz ekle'}
      size={MODAL_WIDTH}
      closeOnClickOutside={!saving}
      styles={MODAL_STYLES}
    >
      <form
        onSubmit={submit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <Box p="md" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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

            <Group align="flex-start" gap="md" wrap="wrap">
              <TextInput
                label="Ad"
                required
                data-autofocus
                style={{ flex: '1 1 16rem' }}
                {...form.getInputProps('name')}
              />
              <Input.Wrapper
                label="Protokol"
                description={editing ? 'Sonradan değiştirilemez; gerekirse cihazı silip yeniden ekleyin.' : undefined}
                inputWrapperOrder={['label', 'input', 'description']}
                style={{ flex: '0 1 auto' }}
              >
                <SegmentedControl
                  display="flex"
                  w="fit-content"
                  data={(['MODBUS', 'MQTT'] as Protocol[]).map((p) => ({ value: p, label: PROTOCOL[p].label }))}
                  disabled={editing}
                  {...form.getInputProps('protocol')}
                />
              </Input.Wrapper>
              <Input.Wrapper label="Durum">
                <Switch label="Etkin" mt={8} {...form.getInputProps('enabled', { type: 'checkbox' })} />
              </Input.Wrapper>
            </Group>

            <Divider label="Bağlantı" labelPosition="left" />

            {protocol === 'MODBUS' ? (
              <>
                <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
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
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
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
          </Stack>
        </Box>

        <Group justify="flex-end" px="md" py="sm" style={{ borderTop: BORDER }}>
          <Button variant="default" onClick={onClose} disabled={saving}>
            Vazgeç
          </Button>
          <Button type="submit" loading={saving}>
            {editing ? 'Kaydet' : 'Ekle'}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
