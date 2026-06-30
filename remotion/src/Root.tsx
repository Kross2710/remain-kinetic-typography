import React from 'react';
import { Composition, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { RemainLyrics, remainSchema } from './RemainLyrics';

const FPS = 60;

// Lưu ý: defaultProps phải là OBJECT LITERAL tĩnh (chuỗi viết thẳng) thì Studio mới "Save default props"
// ngược lại vào code được. Dùng biến -> Remotion không trích xuất/ghi đè được. Để rỗng = chỉ aurora.
const audioMeta = async () => {
  const dur = await getAudioDurationInSeconds(staticFile('remain.flac'));
  return { durationInFrames: Math.ceil(dur * FPS) };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Remain-16x9"
        component={RemainLyrics}
        schema={remainSchema}
        defaultProps={{ bgVideo: 'YTDown_YouTube_fallen-angels-1995-apocalypse-cigarettes_Media_NxZsKWSQJ9I_001_1080p.mp4' }}
        durationInFrames={FPS * 200}
        fps={FPS}
        width={1920}
        height={1080}
        calculateMetadata={audioMeta}
      />
      <Composition
        id="Remain-9x16"
        component={RemainLyrics}
        schema={remainSchema}
        defaultProps={{ bgVideo: 'YTDown_YouTube_fallen-angels-1995-apocalypse-cigarettes_Media_NxZsKWSQJ9I_001_1080p.mp4' }}
        durationInFrames={FPS * 200}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={audioMeta}
      />
    </>
  );
};
