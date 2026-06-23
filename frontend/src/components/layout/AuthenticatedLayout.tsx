import React, { ReactNode, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Code,
  Database,
  FileCheck,
  FunctionSquare,
  Play,
  BarChart3,
  Zap,
  ChevronsUpDown,
  Sun,
  Moon,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarRail,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AuthUser } from 'aws-amplify/auth';
import { ScenarioService } from '../../services/scenario-service';
import SiteHeader from './TopNavigation';

interface AuthenticatedLayoutProps {
  children: ReactNode;
  signOut?: () => void;
  user?: AuthUser;
}

const navigationItems: {
  group: string;
  items: { text: string; href: string; icon: LucideIcon }[];
}[] = [
  {
    group: 'Scenario Management',
    items: [{ text: 'Scenarios', href: '/scenarios', icon: LayoutDashboard }],
  },
  {
    group: 'Rule Configuration',
    items: [
      { text: 'Calculation Editor', href: '/calculation', icon: Code },
      { text: 'Input Validation', href: '/input-validation', icon: FileCheck },
      { text: 'Custom Functions', href: '/functions', icon: FunctionSquare },
    ],
  },
  {
    group: 'Data Management',
    items: [{ text: 'Data Stores', href: '/data-stores', icon: Database }],
  },
  {
    group: 'Test',
    items: [
      { text: 'Test Calculation', href: '/test', icon: Play },
      { text: 'Batch Analytics', href: '/batch-analytics', icon: BarChart3 },
    ],
  },
];

const AuthenticatedLayout: React.FC<AuthenticatedLayoutProps> = ({
  children,
  signOut,
  user,
}) => {
  const [scenarios, setScenarios] = useState<{ label: string; value: string }[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>('DEFAULT');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
  });
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const loadScenarios = async () => {
      try {
        const scenarioList = await ScenarioService.getAll();
        const options = scenarioList.map((s) => ({ label: s.name, value: s.id }));
        setScenarios(options);
        const stored = sessionStorage.getItem('selectedScenario');
        if (stored && options.find((opt) => opt.value === stored)) {
          setSelectedScenario(stored);
        } else {
          const defaultOption = options.find((opt) => opt.value === 'DEFAULT');
          const initial = defaultOption ? 'DEFAULT' : options[0]?.value || 'DEFAULT';
          setSelectedScenario(initial);
          sessionStorage.setItem('selectedScenario', initial);
        }
      } catch (err) {
        console.error('Failed to load scenarios:', err);
      }
    };
    loadScenarios();
  }, []);

  const handleScenarioChange = (scenario: string) => {
    setSelectedScenario(scenario);
    sessionStorage.setItem('selectedScenario', scenario);
    window.dispatchEvent(new Event('scenarioChanged'));
  };

  const getActiveHref = () => {
    const path = location.pathname;
    for (const group of navigationItems) {
      for (const item of group.items) {
        if (path.startsWith(item.href)) return item.href;
      }
    }
    return '/calculation';
  };

  const activeHref = getActiveHref();
  const activePageName =
    navigationItems.flatMap((g) => g.items).find((i) => i.href === activeHref)?.text ??
    'Dashboard';

  const userEmail =
    user?.signInDetails?.loginId || user?.username || 'User';

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => navigate('/scenarios')}>
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Zap className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">AnyUtility</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Rate Engine
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {navigationItems.map(({ group, items }) => (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map(({ text, href, icon: Icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      tooltip={text}
                      isActive={activeHref === href}
                      onClick={() => navigate(href)}
                    >
                      <Icon />
                      <span>{text}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div className="bg-muted flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-medium">
                      {userEmail.charAt(0).toUpperCase()}
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{userEmail}</span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                  side="bottom"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {userEmail}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTheme('light')}>
                    <Sun className="mr-2 size-4" />
                    Light {theme === 'light' && '✓'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTheme('dark')}>
                    <Moon className="mr-2 size-4" />
                    Dark {theme === 'dark' && '✓'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => signOut?.()}>
                    <LogOut className="mr-2 size-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <SiteHeader
          pageName={activePageName}
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          onScenarioChange={handleScenarioChange}
          theme={theme}
          onThemeToggle={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />
        <main className="flex-1 p-6">
          {React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            scenario: selectedScenario,
            scenarios,
            onScenariosChange: setScenarios,
          })}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AuthenticatedLayout;
