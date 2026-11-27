// Run from remotion/: node studio/test/lyric-plane-live.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {PRESETS} from '../effects.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},
  cacheDir:fileURLToPath(new URL('../../node_modules/.vite-lyric-plane-test',import.meta.url)),
  optimizeDeps:{noDiscovery:true,include:['react','react-dom','react-dom/client','react/jsx-dev-runtime','remotion','@remotion/player']},
  server:{middlewareMode:true,hmr:false},plugins:[{name:'fixture',configureServer(server){
    server.middlewares.use('/fixture',(_req,res)=>{
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><style>body{margin:0}</style><div id="root"></div><script type="module" src="/test/lyric-plane-fixture.tsx"></script>');
    });
  }}],
});
const http=createHttpServer(vite.middlewares);
const reference=[{x:.06,y:.37},{x:.94,y:.37},{x:.94,y:.63},{x:.06,y:.63}];
const corners=[{x:.16,y:.18},{x:.84,y:.29},{x:.88,y:.49},{x:.12,y:.42}];
const near=(actual,want,tol=.1)=>assert.ok(Math.abs(actual-want)<tol,`${actual} != ${want}`);

async function checkExport(project) {
  const {startStudioServer}=await import('../server.mjs');
  const dir=await mkdtemp(join(tmpdir(),'remain-lyric-plane-'));
  const ffmpeg=(...args)=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{maxBuffer:16*1024*1024});
  let server;
  try {
    const source=join(dir,'black.mp4');
    const output=join(dir,'lyrics.mp4');
    ffmpeg('-f','lavfi','-i','color=black:s=160x90:r=30:d=4','-pix_fmt','yuv420p','-c:v','libx264',source);
    server=await startStudioServer({port:0,bindHost:'127.0.0.1'});
    const base=`http://127.0.0.1:${server.address().port}`;
    const data=new FormData();
    const startFrame=43,endFrame=59,splitFrame=54;
    data.set('project',JSON.stringify({...project,renderRange:{startFrame,endFrame}}));
    data.set('clip-fixture',new Blob([await readFile(source)]),'black.mp4');
    const res=await fetch(`${base}/api/render`,{method:'POST',body:data});
    const submitted=await res.json();
    assert.equal(res.status,202,JSON.stringify(submitted));
    const url=`${base}/api/render/jobs/${submitted.jobId}`;
    let job;
    const deadline=Date.now()+180_000;
    do {
      job=await (await fetch(url)).json();
      if(job.status!=='running')break;
      await delay(200);
    } while(Date.now()<deadline);
    assert.equal(job.status,'done',JSON.stringify(job));
    const file=await fetch(`${url}/file`);
    assert.equal(file.status,200);
    await writeFile(output,Buffer.from(await file.arrayBuffer()));
    const ffprobe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',output]));
    const video=ffprobe.streams.find(stream=>stream.codec_type==='video');
    assert.deepEqual([video.codec_name,video.width,video.height,Number(video.nb_frames)],['h264',1280,720,endFrame-startFrame]);

    const rgb=ffmpeg('-i',output,'-vf','crop=1280:300:0:0,format=gray','-an','-f','rawvideo','-');
    const area=1280*300;
    assert.equal(rgb.length,area*(endFrame-startFrame));
    // Mid-entry Aurora alpha keeps the glyphs below 100. The dark backdrop is below 5.
    const bright=frame=>rgb.subarray((frame-startFrame)*area,(frame-startFrame+1)*area).reduce((n,value)=>n+(value>25?1:0),0);
    const before=bright(splitFrame-1),after=bright(splitFrame);
    assert.equal(bright(44),0,'no text in the warped region before the attached cue');
    assert.ok(before>20 && after>20,`warped text must be visible on both sides of the cut (${before}, ${after})`);
    assert.ok(after>before/2,'text must not restart on the first frame after the cut');
    console.log(`Studio API exported ${endFrame-startFrame} H.264 frames with warped lyrics continuous across the split.`);
  } finally {
    server?.close();
    server?.closeAllConnections();
    await rm(dir,{recursive:true,force:true});
  }
}

let browser;
try {
  await new Promise((resolve,reject)=>http.once('error',reject).listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH ?? (await ensureBrowser()).path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1300,height:1300}});
  page.on('pageerror',error=>console.error(error));
  await page.goto(`http://127.0.0.1:${http.address().port}/fixture`);
  await page.waitForFunction(()=>typeof window.showLyrics==='function');
  const show=(project,frame)=>page.evaluate(([project,frame])=>window.showLyrics(project,frame),[project,frame]);
  const text=page.locator('[aria-label="One line"]');
  const measure=()=>text.evaluate(el=>{
    const box=el.getBoundingClientRect();
    return {font:getComputedStyle(el).fontSize,w:box.width,h:box.height,x:box.x,y:box.y,
      wordTransform:el.querySelector('[data-word-active]').style.transform};
  });
  for (const [width,height,aspect] of [[1280,720,'wide'],[720,1280,'tall']]) {
    for (const preset of ['classic','aurora','whisper']) {
      const cue={text:'One line',start:0,words:[{text:'One',start:0},{text:'line',start:.2}]};
      const project={width,height,durationInFrames:90,effect:PRESETS[preset],cues:[cue]};
      await show(project,25);
      const legacy=await measure();
      await show({...project,cues:[{...cue,perspective:{corners:reference,aspect}}]},25);
      const identity=await measure();
      for (const k of ['w','h','x','y']) near(identity[k],legacy[k]);
      assert.equal(identity.font,legacy.font);
      await show({...project,cues:[{...cue,perspective:{corners,aspect}}]},25);
      const transformed=await measure();
      assert.equal(transformed.font,legacy.font);
      assert.equal(transformed.wordTransform,legacy.wordTransform);
      assert.ok(transformed.y<legacy.y-60,`${aspect} ${preset} perspective did not move the text`);
      assert.ok(transformed.w<legacy.w-30,`${aspect} ${preset} perspective did not narrow the text`);
      await show({...project,cues:[{...cue,perspective:{corners,aspect:aspect==='wide'?'tall':'wide'}}]},25);
      assert.deepEqual(await measure(),transformed,'aspect warning does not change the saved corner geometry');
    }
  }
  const flowCue={text:'One line',start:0,words:[{text:'One',start:0},{text:'line',start:.2}]};
  const flowProject={width:1280,height:720,durationInFrames:90,effect:PRESETS.classic,
    cues:[{...flowCue,perspective:{corners,aspect:'wide'}}]};
  await show(flowProject,25);
  const fixedPlane=await measure();
  await show({...flowProject,effect:{...PRESETS.classic,motion:{flow:true}}},25);
  assert.deepEqual(await measure(),fixedPlane,'flow must not offset the active perspective plane from its Player handles');
  const song={text:'Song line',start:0,words:[{text:'Song',start:0},{text:'line',start:.2}]};
  const cue={text:'One line',start:.5,words:[{text:'One',start:.5},{text:'line',start:1}]};
  const clips=[
    {id:'intro',mediaId:'fixture',name:'Intro',sourceFrames:120,inFrame:0,outFrame:30,muted:true},
    {id:'left',mediaId:'fixture',name:'Left',sourceFrames:120,inFrame:0,outFrame:24,muted:true},
    {id:'right',mediaId:'fixture',name:'Right',sourceFrames:120,inFrame:24,outFrame:60,muted:true},
  ];
  const project={width:1280,height:720,durationInFrames:90,effect:PRESETS.aurora,videoTrack:clips,cues:[song,{
    ...cue,attachment:{end:1.5,segments:[{clipId:'left',offsetFrames:0},{clipId:'right',offsetFrames:0}]},
    perspective:{corners,aspect:'wide'},
  }]};
  const activeWord=()=>text.locator('[data-word-active="true"]').innerText();
  const songText=page.locator('[aria-label="Song line"]');
  await show(project,5);
  assert.equal(await songText.count(),1,'an active song cue must never also enter the scene layer');
  await show(project,25);
  assert.equal(await text.count(),0,'attached cue must not play at its original song time');
  assert.equal(await songText.count(),1);
  await show(project,53);
  assert.equal(await text.count(),1);
  assert.equal(await songText.count(),1,'song and scene cues render together');
  assert.equal(await activeWord(),'One');
  const textBefore=await text.elementHandle();
  const beforeSplit=await measure();
  await page.evaluate(()=>window.seekLyrics(54));
  assert.equal(await text.count(),1);
  assert.equal(await textBefore.evaluate(el=>el.isConnected),true,'the scene lyric must not remount at the split');
  await textBefore.dispose();
  assert.equal(await activeWord(),'One');
  const atSplit=await measure();
  assert.notEqual(atSplit.wordTransform,'translateY(56%)','entry motion must not restart at the split');
  near(atSplit.y,beforeSplit.y,10);
  await show(project,66);
  assert.equal(await activeWord(),'line','word timing follows source-relative cue time');
  await show(project,75);
  assert.equal(await text.count(),0,'scene cue ends at its exclusive clip-relative end');
  assert.equal(await songText.count(),1);
  console.log('Native lyric plane and scene clocks verified in the Player.');
  if (!process.env.LYRIC_PLANE_PREVIEW_ONLY) await checkExport(project);
} finally {
  try {await browser?.close();} finally {await Promise.all([vite.close(),new Promise(resolve=>http.close(resolve))]);}
}
