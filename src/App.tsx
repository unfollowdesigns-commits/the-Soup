import { LabShell } from './components/LabShell';
import { MobileLab } from './mobile/MobileLab';
import { useLab } from './lab/store';
import { lazy, Suspense } from 'react';

/* TypeGPU and the press composer are whole screens of their own. They are
   loaded when opened so the lab does not carry them. */
const LightBench = lazy(() => import('./gpu/LightBench').then((m) => ({ default: m.LightBench })));
const PressBench = lazy(() => import('./poster/PressBench').then((m) => ({ default: m.PressBench })));
import { EnterLab } from './screens/EnterLab';
import { ImportSpecimen } from './screens/ImportSpecimen';
import { useMediaQuery } from './lab/useMediaQuery';

function Bench({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="bench-wait">
          <span className="lamp" data-state="busy" />
          <span className="mono">opening the bench</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export default function App() {
  const { screen } = useLab();
  const compact = useMediaQuery('(max-width: 900px)');

  if (screen === 'enter') return <EnterLab />;
  if (screen === 'import') return <ImportSpecimen />;
  if (screen === 'press') return <Bench><PressBench /></Bench>;
  if (screen === 'light') return <Bench><LightBench /></Bench>;
  return compact ? <MobileLab /> : <LabShell />;
}
