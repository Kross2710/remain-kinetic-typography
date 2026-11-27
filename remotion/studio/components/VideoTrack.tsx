import {useMemo,type CSSProperties} from 'react';
import {OffthreadVideo,Sequence} from 'remotion';
import {clipSpans,type VideoClip} from '../video-track.mjs';

type TrackEntry = ReturnType<typeof clipSpans>[number] & {src:string};

export function useVideoTrack(clips:VideoClip[]|undefined,sources:Record<string,string>|undefined) {
  return useMemo(()=>clips && sources ? clipSpans(clips).flatMap(clip=>{
    const src=Object.prototype.hasOwnProperty.call(sources,clip.mediaId) ? sources[clip.mediaId] : undefined;
    return src ? [{...clip,src}] : [];
  }) : [],[clips,sources]);
}

export function VideoTrack({entries,className,style}:{entries:TrackEntry[];className?:string;style?:CSSProperties}) {
  return <>{entries.map(({id,src,inFrame,outFrame,startFrame,endFrame,muted,name})=>
    <Sequence key={id} name={name} from={startFrame} durationInFrames={endFrame-startFrame} premountFor={8}>
      <OffthreadVideo src={src} trimBefore={inFrame} trimAfter={outFrame} muted={muted}
        pauseWhenBuffering className={className} style={style}/>
    </Sequence>
  )}</>;
}
