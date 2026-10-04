/** Adapt the upstream sidebar through its public service; preserve user titles. */
export function installSidebarLabels(ctx) {
  return ctx.inject(['betterSidebar', 'locale'], (scope) => {
    const sidebar = scope.betterSidebar;
    if (!sidebar.features?.includes('updateTab') || !sidebar.features?.includes('stateSubscription')) return;
    let syncing = false;
    const sync = () => {
      if (syncing) return;
      const state = sidebar.getSnapshot().state;
      if (!state) return;
      const chinese = scope.locale.getSnapshot().active?.toLowerCase().startsWith('zh');
      const title = chinese ? '文件' : 'Files';
      const tabs = [];
      const visit = (node) => {
        if (node?.kind === 'leaf') tabs.push(...node.tabs);
        else node?.children?.forEach(visit);
      };
      visit(state.splits);
      visit(state.bottomSplits);
      state.floats?.forEach((window) => tabs.push(window.tab));
      syncing = true;
      try {
        for (const tab of tabs) {
          if (tab.type === 'editor' && !tab.path && ['Files', '文件'].includes(tab.title) && tab.title !== title) {
            sidebar.updateTab(tab.id, { title });
          }
        }
      } finally { syncing = false; }
    };
    const offState = sidebar.subscribeState(sync);
    const offLocale = scope.locale.subscribe(sync);
    sync();
    return () => { offState(); offLocale(); };
  });
}
