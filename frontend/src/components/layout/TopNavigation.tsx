import React from 'react';
import { ChevronDown, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface SiteHeaderProps {
  pageName: string;
  scenarios?: { label: string; value: string }[];
  selectedScenario?: string;
  onScenarioChange?: (scenario: string) => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
}

const SiteHeader: React.FC<SiteHeaderProps> = ({
  pageName,
  scenarios = [],
  selectedScenario,
  onScenarioChange,
  theme,
  onThemeToggle,
}) => {
  const selectedLabel =
    scenarios.find((s) => s.value === selectedScenario)?.label ||
    selectedScenario ||
    'Select';

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <nav aria-label="breadcrumb">
          <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <li className="font-medium text-foreground">{pageName}</li>
          </ol>
        </nav>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Scenario: {selectedLabel} <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Scenarios</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {scenarios.map((s) => (
              <DropdownMenuItem
                key={s.value}
                onSelect={() => onScenarioChange?.(s.value)}
              >
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" onClick={onThemeToggle}>
          {theme === 'light' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </header>
  );
};

export default SiteHeader;
