/** Use the settings service owned by the selected Harness version. */
export function bindThemeSettings(ctx, provider = 'settingsScope') {
  // Cordis rejects even probing an undeclared service. Only read the injected branch.
  if (provider === 'settingsScope') return ctx.settingsScope.bind({ namespace: 'jxl-theme' });
  const form = ctx.configForms.get('jxl-theme');
  if (!form) throw new Error('Mochi theme settings are unavailable');
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: listener => form.subscribe(listener),
    async set(field, value) {
      if (!await form.set(field, value)) throw new Error('Mochi theme preference was not saved');
    },
  };
}
