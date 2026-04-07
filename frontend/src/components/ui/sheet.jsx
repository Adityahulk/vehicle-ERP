import * as React from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

const SheetContext = React.createContext({ open: false, onClose: () => {} });

function Sheet({ open, onOpenChange, children }) {
  return (
    <SheetContext.Provider value={{ open, onClose: () => onOpenChange(false) }}>
      {children}
    </SheetContext.Provider>
  );
}

function SheetContent({ className, children, side = 'right' }) {
  const { open, onClose } = React.useContext(SheetContext);

  if (!open) return null;

  const sideClasses = {
    right: 'inset-y-0 right-0 w-full sm:max-w-lg border-l',
    left: 'inset-y-0 left-0 w-full sm:max-w-lg border-r',
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          'fixed z-50 bg-background p-6 shadow-lg overflow-y-auto',
          sideClasses[side],
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </>
  );
}

function SheetHeader({ className, ...props }) {
  return <div className={cn('flex flex-col space-y-2 mb-6', className)} {...props} />;
}

function SheetTitle({ className, ...props }) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}

function SheetDescription({ className, ...props }) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription };
