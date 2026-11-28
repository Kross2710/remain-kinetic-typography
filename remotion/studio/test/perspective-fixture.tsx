import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PerspectiveEditor} from '../components/PerspectiveEditor';
import {defaultPerspectiveCorners, perspectiveMatrix3d} from '../perspective.mjs';
import type {PerspectiveCorners} from '../perspective.mjs';

function Fixture() {
  const [committed, setCommitted] = useState(defaultPerspectiveCorners);
  const [draft, setDraft] = useState<PerspectiveCorners | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [commits, countCommit] = useState(0);
  const corners = draft ?? committed;
  return <>
    <div id="preview" style={{position: 'relative', margin: '80px 120px', width: 400, height: 200}}>
      <div id="video" style={{position: 'absolute', inset: 0, background: 'purple', transformOrigin: '0 0',
        transform: perspectiveMatrix3d(corners, 400, 200) ?? undefined}} />
      <PerspectiveEditor corners={committed} onChange={setDraft} onInvalid={setInvalid}
        onCommit={next => { setCommitted(next); countCommit(count => count + 1); }} />
    </div>
    <output id="state">{JSON.stringify({committed, draft, invalid, commits})}</output>
    <button onClick={() => setCommitted(defaultPerspectiveCorners())}>Reset outside overlay</button>
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
