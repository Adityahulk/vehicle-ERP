import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SortableTableHead({
  children,
  sortKey,
  currentSort,
  currentDirection,
  onSort,
  className,
}) {
  const isActive = currentSort === sortKey;

  const handleClick = () => {
    if (!sortKey || !onSort) return;
    if (isActive) {
      onSort(sortKey, currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
      onSort(sortKey, 'asc');
    }
  };

  if (!sortKey) {
    return (
      <th className={cn('h-10 px-3 text-left align-middle font-medium text-muted-foreground', className)}>
        {children}
      </th>
    );
  }

  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors',
        className,
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1">
        {children}
        {isActive ? (
          currentDirection === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </div>
    </th>
  );
}

/**
 * Client-side sort helper. Pass an array + sort key + direction.
 * Handles strings, numbers, dates, and null/undefined.
 */
export function sortData(data, key, direction = 'asc') {
  if (!key || !data) return data;

  return [...data].sort((a, b) => {
    let valA = a[key];
    let valB = b[key];

    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    let result = 0;
    if (valA < valB) result = -1;
    else if (valA > valB) result = 1;

    return direction === 'desc' ? -result : result;
  });
}
