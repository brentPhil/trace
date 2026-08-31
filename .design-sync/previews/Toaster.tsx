import * as React from 'react';
import { Toaster, createToastManager } from 'chroneli';

/* Toaster is the host: mount it ONCE near the app root and push to it from
 * anywhere with `useToastManager()`. It renders its own portal and viewport,
 * so it takes no children in normal use. */

export function Stacked() {
  const manager = React.useState(() => createToastManager())[0];
  React.useEffect(() => {
    manager.add({
      timeout: 0,
      type: 'success',
      title: 'Entry saved',
      description: '2:45 logged to Acme - Website rebuild.',
    });
    manager.add({
      timeout: 0,
      type: 'info',
      title: 'Timer stopped',
      description: 'Design review ran for 0:45.',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-64 w-full">
      <Toaster toastManager={manager} />
    </div>
  );
}
