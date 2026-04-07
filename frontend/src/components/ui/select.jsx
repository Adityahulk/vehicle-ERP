import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Check } from 'lucide-react';

// ── Basic native select (backward compatible with existing pages) ──
const Select = React.forwardRef(({ className, children, ...props }, ref) => {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 opacity-50 pointer-events-none" />
    </div>
  );
});
Select.displayName = 'Select';

// ── Compound select (custom dropdown) ──

const Ctx = React.createContext({});

function SelectRoot({ value, onValueChange, children }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState(new Map());
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const register = React.useCallback((val, label) => {
    setItems((prev) => {
      const next = new Map(prev);
      next.set(val, label);
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ value, onValueChange, open, setOpen, items, register }}>
      <div ref={ref} className="relative">{children}</div>
    </Ctx.Provider>
  );
}

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const { open, setOpen } = React.useContext(Ctx);
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      {...props}
    >
      <span className="truncate">{children}</span>
      <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
    </button>
  );
});
SelectTrigger.displayName = 'SelectTrigger';

function SelectValue({ placeholder }) {
  const { value, items } = React.useContext(Ctx);
  const label = items.get(value);
  return <span className={cn(!label && 'text-muted-foreground')}>{label || placeholder || ''}</span>;
}

function SelectContent({ className, children, ...props }) {
  const { open } = React.useContext(Ctx);
  if (!open) return null;
  return (
    <div
      className={cn(
        'absolute z-50 mt-1 w-full min-w-[8rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md max-h-60 overflow-y-auto',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function SelectItem({ value: itemValue, children, className, ...props }) {
  const { value, onValueChange, setOpen, register } = React.useContext(Ctx);
  const isSelected = value === itemValue;
  const label = typeof children === 'string' ? children : '';

  React.useEffect(() => {
    register(itemValue, label || itemValue);
  }, [itemValue, label, register]);

  return (
    <button
      type="button"
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
        isSelected && 'bg-accent/50',
        className,
      )}
      onClick={() => { onValueChange(itemValue); setOpen(false); }}
      {...props}
    >
      <span className="truncate">{children}</span>
      {isSelected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  );
}

export {
  Select,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
};
