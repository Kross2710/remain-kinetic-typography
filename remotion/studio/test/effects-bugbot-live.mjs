// Run from remotion/: node studio/test/effects-bugbot-live.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {PRESETS} from '../effects.mjs';
import {startStudioServer} from '../server.mjs';

const line=(text,start,effect,hook=false)=>({text,start,words:[{text,start}],...(effect?{effect}:{}),...(hook?{hook:true}:{})});
const cues=[line('First',0),line('Soak',1,undefined,true),line('Third',2)];
const project=(preset,lines=cues)=>({version:1,width:720,height:1280,durationInFrames:120,effect:PRESETS[preset],cues:lines});
const server=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
let browser;
try{
  const {path}=await ensureBrowser();
  browser=await chromium.launch({executablePath:path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  const load=async p=>{
    await page.getByRole('tab',{name:'Project',exact:true}).click();
    await page.locator('#project-file').setInputFiles({name:'bugbot.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
    await page.getByText('Đã nạp bugbot.json',{exact:false}).waitFor();
  };
  const seek=async frame=>{
    await slider.fill(String(frame));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await slider.inputValue(),String(frame));
  };
  const atmosphere=page.locator('[data-whisper-atmosphere]');
  const past=page.locator('[data-whisper-past]');
  const active=page.locator('[data-lyric-preset]');

  await load({...project('whisper'),effect:{...PRESETS.whisper,motion:{enter:true}}});
  await seek(34);
  assert.equal(await active.getAttribute('data-shared-entry'),'true');
  const letters=active.locator('[data-whisper-letter]');
  assert.ok(await letters.count()>1,'Whisper hook must still render per-character soak with shared enter and ink off');
  assert.equal(await letters.first().evaluate(el=>getComputedStyle(el.parentElement.parentElement).overflow),'hidden',
    'Shared enter must keep the per-word clip mask while hook letters soak in');
  const opacity=await letters.evaluateAll(nodes=>nodes.map(el=>Number(el.style.opacity)));
  assert.ok(opacity.some(value=>value<1) && opacity.some(value=>value>0),`Hook letters must soak in: ${opacity}`);

  await load(project('whisper',[cues[0],line('Classic',1,PRESETS.classic),cues[2]]));
  await seek(35);
  assert.equal(await active.getAttribute('data-lyric-preset'),'classic');
  assert.equal(await atmosphere.count(),1,'Project Whisper atmosphere must survive Classic line override');
  assert.equal(await past.count(),1,'Project Whisper history must survive Classic line override');
  await load(project('whisper',[cues[0],line('Aurora',1,PRESETS.aurora),cues[2]]));
  await seek(35);
  assert.equal(await active.getAttribute('data-lyric-preset'),'aurora');
  assert.equal(await atmosphere.count(),1,'Project Whisper atmosphere must survive Aurora line override');
  assert.equal(await past.count(),1,'Project Whisper history must survive Aurora line override');

  await load(project('classic',[cues[0],line('Whisper',1,PRESETS.whisper),cues[2]]));
  await seek(35);
  assert.equal(await active.getAttribute('data-lyric-preset'),'whisper');
  assert.equal(await atmosphere.count(),0,'Classic project must not gain Whisper atmosphere from line override');
  assert.equal(await past.count(),0,'Classic project must not gain Whisper history from line override');
  // Render the two affected combinations through the real API and compare
  // the decoded MP4 frame with the same native-size preview frame.
  await page.addStyleTag({content:'.stage.stage {width:720px!important;height:1280px!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;border-radius:0!important;padding:0!important}.stage.stage > div {max-width:none!important;border:0!important;box-shadow:none!important}'});
  const out=await mkdtemp(join(tmpdir(),'remain-effects-bugbot-'));
  async function renderAndCompare(p,label){
    const frame=35;
    await load(p);
    await seek(frame);
    const preview=join(out,`${label}-preview.png`);
    await page.locator('.stage').screenshot({path:preview});
    const form=new FormData();
    form.set('project',JSON.stringify({...p,renderRange:{startFrame:frame,endFrame:frame+2}}));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/render`,{method:'POST',body:form});
    assert.equal(response.status,202,await response.clone().text());
    const {jobId}=await response.json();
    let job;
    for(let i=0;i<400;i++){
      job=await (await fetch(`http://127.0.0.1:${server.address().port}/api/render/jobs/${jobId}`)).json();
      if(job.status!=='running')break;
      await delay(250);
    }
    assert.equal(job.status,'done',JSON.stringify(job));
    const video=await fetch(`http://127.0.0.1:${server.address().port}/api/render/jobs/${jobId}/file`);
    assert.equal(video.status,200);
    const mp4=join(out,`${label}.mp4`);
    await writeFile(mp4,Buffer.from(await video.arrayBuffer()));
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',mp4],{encoding:'utf8'}));
    const {codec_name,width,height,nb_frames}=probe.streams[0];
    assert.deepEqual({codec_name,width,height,nb_frames},{codec_name:'h264',width:720,height:1280,nb_frames:'2'});
    const rgb=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-pix_fmt','rgb24','-threads:v','1','-f','rawvideo','-'],{maxBuffer:4*1024*1024});
    const a=rgb(mp4),b=rgb(preview);
    assert.equal(a.length,720*1280*3);
    assert.equal(b.length,a.length);
    let error=0;
    for(let i=0;i<a.length;i++)error+=(a[i]-b[i])**2;
    const psnr=10*Math.log10(255**2/(error/a.length));
    assert.ok(psnr>30,`${label} preview/MP4 mismatch: ${psnr.toFixed(2)} dB`);
    console.log(`${label}: preview/MP4 ${psnr.toFixed(2)} dB`);
  }
  await renderAndCompare({...project('whisper'),effect:{...PRESETS.whisper,motion:{enter:true}}},'hook-enter');
  await renderAndCompare(project('whisper',[cues[0],line('Aurora',1,PRESETS.aurora),cues[2]]),'whisper-aurora');
  assert.deepEqual(errors,[]);
  console.log(`Bugbot effects regressions verified in live preview and MP4: ${out}`);
}finally{
  await browser?.close();
  server.close();server.closeAllConnections();
}
