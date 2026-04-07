import * as React from 'react';
import { cn } from '@/lib/utils';

const TabsContext = React.createContext({ value: '', onValueChange: () => {} });

function Tabs({ value, onValueChange, defaultValue, children, className, ...props }) {
  const [internal, setInternal] = React.useState(defaultValue || '');
  const current = value !== undefined ? value : internal;
  const change = onValueChange || setInternal;

  return (
    <TabsContext.Provider value={{ value: current, onValueChange: change }}>
      <div className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground gap-1',
        className,
      )}
      role="tablist"
      {...props}
    >
      {children}
    </div>
  );
}

function TabsTrigger({ value, className, children, ...props }) {
  const ctx = React.useContext(TabsContext);
  const isActive = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'hover:bg-background/50 hover:text-foreground',
        className,
      )}
      onClick={() => ctx.onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

function TabsContent({ value, className, children, ...props }) {
  const ctx = React.useContext(TabsContext);
  if (ctx.value !== value) return null;

  return (
    <div
      role="tabpanel"
      className={cn('mt-4 ring-offset-background focus-visible:outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
