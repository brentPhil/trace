import * as React from 'react';
import { Toaster, createToastManager } from 'chroneli';

/* A toast only exists inside its provider, driven by a toast manager - there
 * is no static `<Toast>` to render on its own. So the card composes the real
 * thing: a Toaster with its own manager, seeded on mount.
 *
 * The manager is created per component instance (useState initialiser, not a
 * module-level const) so the cells in the grid card do not all push onto one
 * shared queue and stack on top of each other. */
function useSeededToaster(entries: Array<Record<string, unknown>>) {
  const manager = React.useState(() => createToastManager())[0];
  React.useEffect(() => {
    for (const e of entries) manager.add({ timeout: 0, ...e });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return manager;
}

export function Success() {
  const manager = useSeededToaster([
    {
      type: 'success',
      title: 'Entry saved',
      description: '2:45 logged to Acme - Website rebuild.',
    },
  ]);
  return (
    <div className="h-56 w-full">
      <Toaster toastManager={manager} />
    </div>
  );
}

export function WithAction() {
  const manager = useSeededToaster([
    {
      type: 'info',
      title: 'Entry deleted',
      description: '"Invoice export bug" was removed from Thursday.',
      actionProps: { children: 'Undo' },
    },
  ]);
  return (
    <div className="h-56 w-full">
      <Toaster toastManager={manager} />
    </div>
  );
}

export function Error() {
  const manager = useSeededToaster([
    {
      type: 'error',
      title: 'Export failed',
      description: 'The invoice could not be generated. Try again.',
    },
  ]);
  return (
    <div className="h-56 w-full">
      <Toaster toastManager={manager} />
    </div>
  );
}
