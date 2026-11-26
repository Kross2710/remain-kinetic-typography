import {Composition, registerRoot} from 'remotion';
import {Scene,type SceneProps} from './Scene';
import {FPS} from './project.mjs';

const defaultProps:SceneProps = {project:{width:720,height:1280,durationInFrames:900,cues:[]},audioSrc:null,videoSrc:null};

function StudioRoot() {
  return <Composition id="StudioClip" component={Scene} defaultProps={defaultProps} fps={FPS} width={720} height={1280} durationInFrames={900} calculateMetadata={({props})=>({width:props.project.width,height:props.project.height,durationInFrames:props.project.durationInFrames})}/>;
}
registerRoot(StudioRoot);
