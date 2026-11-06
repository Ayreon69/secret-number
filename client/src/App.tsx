import { MotionConfig, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useEffect } from 'react';
import { RulesModal } from './components/Rules';
import { Final } from './screens/Final';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Table } from './screens/Table';
import { useStore } from './store';

export function App() {
  const view = useStore((s) => s.view);
  const conn = useStore((s) => s.conn);
  const everConnected = useStore((s) => s.everConnected);
  const toast = useStore((s) => s.toast);
  const screen = !view ? 'home' : view.phase;
  // Chaque écran commence en haut : sinon le salon hérite du défilement de l'accueil.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  return (
    <MotionConfig reducedMotion="user">
      {!view ? <Home /> : view.phase === 'lobby' ? <Lobby view={view} /> : view.phase === 'finished' ? <Final view={view} /> : <Table view={view} />}
      <RulesModal />
      {view && conn !== 'online' && everConnected && (
        <div className="conn-banner" role="status">
          <WifiOff size={16} /> Connexion perdue : reconnexion en cours…
        </div>
      )}
      {toast && (
        <motion.div
          key={toast.id}
          className={`toast is-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          onClick={() => useStore.setState({ toast: null })}
        >
          {toast.text}
        </motion.div>
      )}
    </MotionConfig>
  );
}
