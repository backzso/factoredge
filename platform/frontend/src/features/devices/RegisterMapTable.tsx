import { ActionIcon, Button, Group, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { REGISTER_TYPES, type RegisterType } from '../../api/types';
import { REGISTER_TYPE_LABEL, SIGNAL_LABEL, SIGNAL_ORDER } from '../../lib/labels';
import { type DeviceFormValues, emptyRow, is32Bit } from './deviceForm';

const SIGNAL_OPTIONS = SIGNAL_ORDER.map((s) => ({ value: s, label: SIGNAL_LABEL[s] }));
const FC_OPTIONS = [
  { value: '3', label: '3 · Holding' },
  { value: '4', label: '4 · Input' },
];
const TYPE_OPTIONS = REGISTER_TYPES.map((t) => ({ value: t, label: REGISTER_TYPE_LABEL[t] }));
const WORD_ORDER_OPTIONS = ['ABCD', 'CDAB'];

export function RegisterMapTable({ form }: { form: UseFormReturnType<DeviceFormValues> }) {
  const rows = form.values.config.registerMap;
  const tableError = form.errors['config.registerMap'];
  const path = (i: number, col: string) => `config.registerMap.${i}.${col}`;

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={500} size="sm">
          Register haritası
        </Text>
        <Button
          size="xs"
          variant="light"
          onClick={() => form.insertListItem('config.registerMap', emptyRow())}
        >
          Satır ekle
        </Button>
      </Group>
      {tableError && (
        <Text c="red" size="xs" style={{ whiteSpace: 'pre-line' }}>
          {tableError}
        </Text>
      )}
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing={4} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sinyal</Table.Th>
              <Table.Th>FC</Table.Th>
              <Table.Th>Offset</Table.Th>
              <Table.Th>Tip</Table.Th>
              <Table.Th>Kelime sırası</Table.Th>
              <Table.Th>Ölçek</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, i) => (
              <Table.Tr key={row.key} style={{ verticalAlign: 'top' }}>
                <Table.Td>
                  <Select
                    size="xs"
                    data={SIGNAL_OPTIONS}
                    allowDeselect={false}
                    aria-label="Sinyal"
                    {...form.getInputProps(path(i, 'signal'))}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    w={110}
                    data={FC_OPTIONS}
                    allowDeselect={false}
                    aria-label="Fonksiyon kodu"
                    {...form.getInputProps(path(i, 'fc'))}
                  />
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    w={90}
                    min={0}
                    max={65535}
                    allowDecimal={false}
                    allowNegative={false}
                    aria-label="Offset"
                    {...form.getInputProps(path(i, 'offset'))}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    w={170}
                    data={TYPE_OPTIONS}
                    allowDeselect={false}
                    aria-label="Tip"
                    {...form.getInputProps(path(i, 'type'))}
                    onChange={(value) => {
                      const type = value as RegisterType;
                      form.setFieldValue(path(i, 'type'), type);
                      // No default word order: guessing ABCD silently corrupts CDAB values.
                      if (!is32Bit(type)) form.setFieldValue(path(i, 'wordOrder'), null);
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  {is32Bit(row.type) ? (
                    <Select
                      size="xs"
                      w={100}
                      data={WORD_ORDER_OPTIONS}
                      placeholder="Seçin"
                      aria-label="Kelime sırası"
                      {...form.getInputProps(path(i, 'wordOrder'))}
                    />
                  ) : (
                    <Text size="xs" c="dimmed" pt={6}>
                      —
                    </Text>
                  )}
                  {/* An issue on a hidden wordOrder still has a place to show up. */}
                  {!is32Bit(row.type) && form.errors[path(i, 'wordOrder')] && (
                    <Text size="xs" c="red">
                      {form.errors[path(i, 'wordOrder')]}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <NumberInput
                    size="xs"
                    w={90}
                    decimalSeparator=","
                    allowNegative={false}
                    aria-label="Ölçek"
                    {...form.getInputProps(path(i, 'scale'))}
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label="Satırı sil"
                    title="Satırı sil"
                    onClick={() => form.removeListItem('config.registerMap', i)}
                  >
                    ✕
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
