import { NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { REGISTER_TYPES, type RegisterType, SIGNALS, type Signal } from '../../api/types';
import { REGISTER_SIGNAL } from '../../lib/labels';
import { type DeviceFormValues, is32Bit } from './deviceForm';

const FC_OPTIONS = [
  { value: '3', label: '3 · Holding' },
  { value: '4', label: '4 · Input' },
];
const WORD_ORDER_OPTIONS = ['ABCD', 'CDAB'];

/** Below this width (phones) the table scrolls sideways; the modal is wider than this. */
const TABLE_MIN_WIDTH = 720;

/** Fixed rows, one per signal: the backend wants each signal exactly once. */
export function RegisterMapTable({ form }: { form: UseFormReturnType<DeviceFormValues> }) {
  const tableError = form.errors['config.registerMap'];
  const path = (signal: Signal, col: string) => `config.registerMap.${signal}.${col}`;

  return (
    <Stack gap="xs">
      <Text fw={500} size="sm">
        Register haritası
      </Text>
      {tableError && (
        <Text c="red" size="xs" style={{ whiteSpace: 'pre-line' }}>
          {tableError}
        </Text>
      )}
      <Table.ScrollContainer minWidth={TABLE_MIN_WIDTH} type="native">
        <Table layout="fixed" verticalSpacing={6} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w="26%">Sinyal</Table.Th>
              <Table.Th w="16%">FC</Table.Th>
              <Table.Th w="13%">Offset</Table.Th>
              <Table.Th w="15%">Tip</Table.Th>
              <Table.Th w="15%">Kelime sırası</Table.Th>
              <Table.Th w="15%">Ölçek</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {SIGNALS.map((signal) => {
              const row = form.values.config.registerMap[signal];
              const { label, unit } = REGISTER_SIGNAL[signal];
              return (
                <Table.Tr key={signal} style={{ verticalAlign: 'top' }}>
                  <Table.Td>
                    <Text size="sm" fw={500} lh={1.3}>
                      {label}
                    </Text>
                    <Text size="xs" c="dimmed" lh={1.3}>
                      {unit}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={FC_OPTIONS}
                      allowDeselect={false}
                      aria-label={`${label}: fonksiyon kodu`}
                      {...form.getInputProps(path(signal, 'fc'))}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      min={0}
                      max={65535}
                      allowDecimal={false}
                      allowNegative={false}
                      aria-label={`${label}: offset`}
                      {...form.getInputProps(path(signal, 'offset'))}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={REGISTER_TYPES}
                      allowDeselect={false}
                      aria-label={`${label}: tip`}
                      {...form.getInputProps(path(signal, 'type'))}
                      onChange={(value) => {
                        const type = value as RegisterType;
                        form.setFieldValue(path(signal, 'type'), type);
                        // No default word order: guessing ABCD silently corrupts CDAB values.
                        if (!is32Bit(type)) form.setFieldValue(path(signal, 'wordOrder'), null);
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    {is32Bit(row.type) ? (
                      <Select
                        size="xs"
                        data={WORD_ORDER_OPTIONS}
                        placeholder="Seçin"
                        aria-label={`${label}: kelime sırası`}
                        {...form.getInputProps(path(signal, 'wordOrder'))}
                      />
                    ) : (
                      <Text size="xs" c="dimmed" pt={6}>
                        —
                      </Text>
                    )}
                    {/* An issue on a hidden wordOrder still has a place to show up. */}
                    {!is32Bit(row.type) && form.errors[path(signal, 'wordOrder')] && (
                      <Text size="xs" c="red">
                        {form.errors[path(signal, 'wordOrder')]}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      decimalSeparator=","
                      allowNegative={false}
                      aria-label={`${label}: ölçek`}
                      {...form.getInputProps(path(signal, 'scale'))}
                    />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
