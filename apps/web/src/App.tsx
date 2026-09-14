import { useEffect } from 'react';
import { closeConfig, openConfig, selectedAgent, setScreen, useAppState } from './store';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { MainPane } from './components/MainPane';
import { RightPanel } from './components/RightPanel';
import { MeshView } from './components/MeshView';
import { ConfigPopover } from './components/ConfigPopover';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';

export function App() {
  const state = useAppState();
  const { projection, connected, screen, configAgentId } = state;
  const agent = selectedAgent(state);

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (configAgentId) {
          closeConfig();
        } else if (screen === 'mesh') {
          setScreen('workbench');
        }
        return;
      }
      if (e.metaKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        openConfig();
      } else if (e.metaKey && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        openConfig();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [configAgentId, screen]);

  const configAgent = configAgentId
    ? projection?.agents.find((a) => a.id === configAgentId) ?? null
    : null;

  return (
    <div className="shell">
      <Titlebar
        projection={projection}
        selectedWorkspaceId={state.selectedWorkspaceId}
        screen={screen}
      />

      {projection === null ? (
        <div className="loading">连接 gateway…</div>
      ) : screen === 'mesh' ? (
        <MeshView projection={projection} pair={state.meshPair} />
      ) : (
        <div className="app">
          <Sidebar
            projection={projection}
            selectedWorkspaceId={state.selectedWorkspaceId}
            selectedAgentId={state.selectedAgentId}
          />
          <MainPane
            projection={projection}
            agent={agent}
            paneText={agent ? state.panes[agent.id] ?? '' : ''}
          />
          <RightPanel
            projection={projection}
            selectedAgent={agent}
            paneText={agent ? state.panes[agent.id] ?? '' : ''}
            tab={state.rightTab}
          />
        </div>
      )}

      <StatusBar projection={projection} connected={connected} />

      {projection && configAgent && (
        <ConfigPopover projection={projection} agent={configAgent} />
      )}
      <Toasts toasts={state.toasts} />
    </div>
  );
}
