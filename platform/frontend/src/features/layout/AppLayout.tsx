import { AppShell, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NavLink as RouterNavLink, Outlet, useLocation } from 'react-router';
import { useCan, useLogout, useMe } from '../../api/auth';
import { ROLE_LABEL } from '../../lib/labels';
import { useLiveStream } from '../../live/useLiveStream';
import { LiveIndicator } from './LiveIndicator';

interface NavItem {
  to: string;
  label: string;
  visible: boolean;
}

export function AppLayout() {
  const { data: user } = useMe();
  const canManageUsers = useCan('manageUsers');
  const logout = useLogout();
  const liveStatus = useLiveStream();
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure();
  const location = useLocation();

  const items: NavItem[] = [
    { to: '/', label: 'Panel', visible: true },
    { to: '/history', label: 'Geçmiş', visible: true },
    { to: '/devices', label: 'Cihazlar', visible: true },
    { to: '/users', label: 'Kullanıcılar', visible: canManageUsers },
  ];

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <Title order={4}>FactorEdge</Title>
            <LiveIndicator status={liveStatus} />
          </Group>
          <Group gap="sm" wrap="nowrap">
            {user && (
              <Text size="sm" visibleFrom="xs">
                {user.username}{' '}
                <Text span c="dimmed" size="sm">
                  ({ROLE_LABEL[user.role]})
                </Text>
              </Text>
            )}
            <Button
              variant="default"
              size="xs"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
            >
              Çıkış
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {items
          .filter((item) => item.visible)
          .map((item) => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              active={
                item.to === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.to)
              }
              onClick={closeNav}
            />
          ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
