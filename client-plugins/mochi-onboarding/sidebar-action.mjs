import React from 'react';
import { Button, Tooltip, IconArchiveOutlineRegular, IconClockOutlineRegular, IconQuestionOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

export const sidebarIcons = { memory: IconArchiveOutlineRegular, planner: IconClockOutlineRegular, guide: IconQuestionOutlineRegular };

/** The public sidebar owner supplies wide=false for its 56px rail. */
export function SidebarAction({ wide = true, label, description, icon: Icon, onClick }) {
  const button = React.createElement(Button, {
    type: 'button', variant: 'ghost', size: 'md', onClick,
    'aria-label': description, title: description,
    'data-mochi-sidebar-action': label, 'data-wide': String(wide),
    style: { width: wide ? '100%' : 36, minWidth: wide ? 0 : 36, height: 36, padding: wide ? '0 8px' : 0,
      justifyContent: wide ? 'flex-start' : 'center', flexShrink: 0, whiteSpace: 'nowrap', borderRadius: wide ? 12 : '50%' },
    icon: React.createElement(Icon, { size: 18, 'aria-hidden': true }),
  }, wide ? React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label) : null);
  return React.createElement(Tooltip, { label: description, side: 'right', portal: true, disabled: wide }, button);
}
