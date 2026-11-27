import {Player,type PlayerRef} from '@remotion/player';
import {createRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Scene,type SceneProps} from '../Scene';

const root=createRoot(document.getElementById('root')!);
const player=createRef<PlayerRef>();
Object.assign(window,{
  showLyrics(project:SceneProps['project'],frame:number){
    flushSync(()=>root.render(<Player key={`${project.width}/${frame}`} ref={player} component={Scene}
      inputProps={{project,audioSrc:null,videoSrc:null}} initialFrame={frame} durationInFrames={project.durationInFrames}
      compositionWidth={project.width} compositionHeight={project.height} fps={30} style={{width:project.width,height:project.height}}
      acknowledgeRemotionLicense/>));
  },
  seekLyrics(frame:number){flushSync(()=>player.current?.seekTo(frame));},
});
