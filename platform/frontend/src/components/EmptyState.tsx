import { Paper, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack align="center" gap="xs">
        <Title order={4}>{title}</Title>
        {children && (
          <Text c="dimmed" ta="center" component="div">
            {children}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
