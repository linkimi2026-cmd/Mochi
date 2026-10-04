/** Scope to the verified Harness header/content siblings, never a global active pane. */
export function scopeTeamConversationPalette(anchor, sessionId, palette) {
  const frame = anchor?.closest('[data-slot="conversation.header"]')?.parentElement;
  const content = [...(frame?.children ?? [])].find(element =>
    element.matches('[data-conversation-content]') &&
    element.getAttribute('data-conversation-session') === sessionId);
  if (!content) return () => {};
  const previous = content.getAttribute('data-mochi-pet-palette');
  content.setAttribute('data-mochi-pet-palette', palette);
  return () => {
    if (content.getAttribute('data-mochi-pet-palette') !== palette) return;
    if (previous === null) content.removeAttribute('data-mochi-pet-palette');
    else content.setAttribute('data-mochi-pet-palette', previous);
  };
}
