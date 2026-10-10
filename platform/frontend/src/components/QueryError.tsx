import { Alert, Button } from '@mantine/core';
import { describeError } from '../api/errors';

export function QueryError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { title, message } = describeError(error);
  return (
    <Alert color="red" title={title}>
      {message}
      {onRetry && (
        <Button size="xs" variant="light" color="red" mt="sm" display="block" onClick={onRetry}>
          Tekrar dene
        </Button>
      )}
    </Alert>
  );
}
