import { LabShell } from './components/LabShell';
import { MobileLab } from './mobile/MobileLab';
import { useLab } from './lab/store';
import { PressBench } from './poster/PressBench';
import { EnterLab } from './screens/EnterLab';
import { ImportSpecimen } from './screens/ImportSpecimen';
import { useMediaQuery } from './lab/useMediaQuery';

export default function App() {
  const { screen } = useLab();
  const compact = useMediaQuery('(max-width: 900px)');

  if (screen === 'enter') return <EnterLab />;
  if (screen === 'import') return <ImportSpecimen />;
  if (screen === 'press') return <PressBench />;
  return compact ? <MobileLab /> : <LabShell />;
}
