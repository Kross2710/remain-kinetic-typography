// Run from remotion/: node studio/test/web-match-live.mjs [artifact directory]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {PRESETS} from '../effects.mjs';
import {FPS} from '../project.mjs';
import {startStudioServer} from '../server.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const out=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(tmpdir(),'remain-web-match-'));
await mkdir(out,{recursive:true});
const app=express();
app.get('/',(_req,res)=>res.sendFile(join(root,'index.html')));
app.use('/src',express.static(join(root,'src')));
app.use('/assets',express.static(join(root,'assets')));
app.use('/fonts',express.static(join(root,'remotion/studio/assets/web-match')));
const web=app.listen(0,'127.0.0.1');
await once(web,'listening');
const refUrl=`http://127.0.0.1:${web.address().port}`;
const studio=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
const studioUrl=`http://127.0.0.1:${studio.address().port}`;
const errors=[];
const ff=(...args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{maxBuffer:4*1024*1024});
const probe=(...args)=>execFileSync('ffprobe',['-v','error',...args],{encoding:'utf8'});
let browser;
try{
  const runtime=await ensureBrowser();
  browser=await chromium.launch({executablePath:runtime.path,args:['--no-sandbox']});
  const ref=await browser.newPage({viewport:{width:1280,height:720}});
  ref.on('pageerror',error=>errors.push(`web: ${error.message}`));
  // Serve the identical packaged fonts to both pages so the check needs no
  // Google Fonts network call and covers the real site's stylesheet and player.
  await ref.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:
    `@font-face{font-family:Fraunces;src:url('${refUrl}/fonts/fraunces.ttf');font-weight:100 900}@font-face{font-family:'Instrument Serif';src:url('${refUrl}/fonts/instrumentserif.ttf');font-style:italic}@font-face{font-family:'Hanken Grotesk';src:url('${refUrl}/fonts/hankengrotesk.ttf');font-weight:100 900}`}));
  await ref.goto(refUrl);
  await ref.evaluate(async()=>{
    await Promise.all([document.fonts.load('300 48px Fraunces'),document.fonts.load('italic 48px "Instrument Serif"')]);
    await window.KT.render.begin();
    document.querySelectorAll('.au').forEach(el=>el.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=0;}));
  });
  const cues=await ref.evaluate(()=>window.KT.debug.cues.flatMap((cue,i,all)=>{
    if(!cue.text)return [];
    return [{text:cue.text,start:cue.time,words:window.KT.getWordTimings(cue.text,cue.time,all[i+1]?.time ?? cue.time+4).map(w=>({text:w.word,start:Math.max(cue.time,w.start),confirmed:true}))}];
  }));
  const hook=cues.find(cue=>cue.start>60 && /will remain/.test(cue.text));
  assert.ok(hook);
  assert.equal(hook.words.at(-1).text.toLowerCase(),'love');
  const firstFrame=t=>{const n=Math.round(t*FPS);return n/FPS>=t?n:n+1;};
  const hookFrame=firstFrame(hook.start), loveFrame=firstFrame(hook.words.at(-1).start);
  const samples=[hookFrame-3,hookFrame+6,hookFrame+26,loveFrame-1,loveFrame+7,loveFrame+25];
  const startFrame=samples[0], endFrame=samples.at(-1)+1;
  const project={version:1,width:1280,height:720,durationInFrames:5856,cues,effect:PRESETS['web-match'],renderRange:{startFrame,endFrame}};
  await writeFile(join(out,'web-match.project.json'),JSON.stringify(project,null,2));
  const page=await browser.newPage({viewport:{width:2080,height:1000},acceptDownloads:true});
  page.on('pageerror',error=>errors.push(`studio: ${error.message}`));
  page.on('requestfailed',req=>{if(!req.failure()?.errorText.includes('ERR_ABORTED'))errors.push(`network: ${req.url()}: ${req.failure()?.errorText}`);});
  await page.goto(studioUrl);
  const tab=name=>page.getByRole('tab',{name,exact:true}).click();
  await tab('Hiệu ứng');
  const scope=page.getByLabel('Phạm vi hiệu ứng');
  const preset=page.getByLabel('Preset chữ');
  await scope.selectOption('line');
  assert.ok(await preset.locator('option[value="web-match"]').isDisabled());
  await scope.selectOption('project');
  await preset.selectOption('web-match');
  const iframe=page.frameLocator('iframe[data-web-match]');
  await iframe.locator('html[data-web-match-frame="0"]').waitFor();
  await tab('Media');
  await page.locator('#audio-file').setInputFiles(join(root,'assets/audio/clip.mp3'));
  await page.locator('#video-file').setInputFiles(join(root,'assets/video/bg-web-desktop.mp4'));
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="Vị trí timeline"]')?.max)>2000);
  await tab('Project');
  await page.locator('#project-file').setInputFiles(join(out,'web-match.project.json'));
  await page.getByText('Đã nạp web-match.project.json',{exact:false}).waitFor();
  await page.addStyleTag({content:'.stage.stage {width:1280px!important;height:720px!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;border-radius:0!important;padding:0!important}.stage.stage > div {max-width:none!important;border:0!important;box-shadow:none!important}'});
  const active=iframe.locator('.line.is-active');
  const stage=page.locator('.stage');
  const state=(root)=>{
    const doc=root.ownerDocument;
    const line=doc.querySelector('.line.is-active');
    const held=line?.querySelector('.is-held');
    return {flow:doc.querySelector('.flow').style.transform,active:line?.textContent ?? '',hook:line?.classList.contains('hook'),font:line?getComputedStyle(line).fontFamily:null,opacity:line?.style.opacity,blur:line?.style.filter,word:line?.querySelector('.word-inner')?.style.transform,held:held?.style.opacity,heldLetter:held?.querySelector('.char')?.style.opacity,accent:doc.documentElement.style.getPropertyValue('--accent'),wipe:line?.querySelector('.word.is-current .char')?.style.getPropertyValue('--cp')};
  };
  const refFrame=(frame,prev)=>ref.evaluate(async ({frame,prev,fps})=>{
    for(let f=prev+1;f<frame;f++)window.KT.render.step(f/fps);
    await window.KT.render.seek(frame/fps);
  },{frame,prev,fps:FPS});
  async function seek(frame){
    await slider.fill(String(frame));
    await iframe.locator(`html[data-web-match-frame="${frame}"]`).waitFor();
    await iframe.locator('video.bgvideo').evaluate((el,t)=>new Promise((resolve,reject)=>{
      const deadline=performance.now()+6000;
      const check=()=>{
        if(Math.abs(el.currentTime-t)<.08 && !el.seeking)resolve();
        else if(performance.now()>deadline)reject(Error(`Background seek wanted ${t}, reached ${el.currentTime} (state ${el.readyState})`));
        else requestAnimationFrame(check);
      };
      check();
    }),frame/FPS,{timeout:7000});
  }
  let prev=0;
  const snapshots=new Map();
  for(const frame of samples){
    await refFrame(frame,prev);prev=frame;
    await seek(frame);
    const expected=await ref.locator('html').evaluate(state);
    const actual=await iframe.locator('html').evaluate(state);
    assert.deepEqual(actual,expected,`Web motion mismatch on frame ${frame}`);
    snapshots.set(frame,actual);
    await ref.screenshot({path:join(out,`index-f${frame}.png`)});
    await stage.screenshot({path:join(out,`studio-f${frame}.png`),style:'.inspector,.transport,.topbar{visibility:hidden!important}'});
  }
  assert.equal(snapshots.get(loveFrame-1).held,'0');
  assert.equal(snapshots.get(loveFrame+7).held,'1');
  assert.equal(snapshots.get(hookFrame+6).hook,true);
  assert.match(snapshots.get(hookFrame-3).font,/Fraunces/);
  assert.match(snapshots.get(hookFrame+6).font,/Instrument Serif/);
  const outro=await ref.evaluate(()=>window.KT.debug.cues.at(-1));
  assert.equal(outro.text,'');
  const outroFrame=firstFrame(outro.time);
  await refFrame(outroFrame,prev);
  await seek(outroFrame);
  assert.deepEqual(await iframe.locator('html').evaluate(state),await ref.locator('html').evaluate(state),'The site outro must clear the active lyric');
  await seek(hookFrame+6);
  assert.equal(await active.evaluate(el=>el.style.filter),snapshots.get(hookFrame+6).blur);
  await iframe.locator('html').evaluate(el=>{
    const doc=el.ownerDocument;
    doc.dispatchEvent(new doc.defaultView.Event('visibilitychange'));
  });
  assert.deepEqual(await iframe.locator('html').evaluate(state),snapshots.get(hookFrame+6),'Iframe visibility must not change the current pose');
  await page.getByRole('combobox',{name:/Khung hình/}).selectOption('tall');
  await iframe.locator(`html[data-web-match-frame="${hookFrame+6}"]`).waitFor();
  assert.equal(await iframe.locator('html').evaluate(el=>el.ownerDocument.defaultView.innerWidth),360);
  assert.match(await active.evaluate(el=>getComputedStyle(el).fontFamily),/Instrument Serif/);
  const custom={...project,cues:[{text:'Hold here',start:4,words:[{text:'Hold',start:4},{text:'here',start:10}]}],renderRange:undefined};
  await page.locator('#project-file').setInputFiles({name:'edited.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(custom))});
  await page.getByText('Đã nạp edited.json',{exact:false}).waitFor();
  await seek(301);
  const wipe=await active.locator('.word.is-current .char').first().evaluate(el=>Number(el.style.getPropertyValue('--cp')));
  assert.ok(wipe>0 && wipe<1,`Edited final word should wipe gradually, got ${wipe}`);
  assert.deepEqual(errors,[]);
  if(!process.env.STUDIO_PREVIEW_ONLY){
    const form=new FormData();form.set('project',JSON.stringify(project));
    for(const [field,path] of [['audio','assets/audio/clip.mp3'],['video','assets/video/bg-web-desktop.mp4']]){
      form.set(field,new Blob([await readFile(join(root,path))]),path.split('/').at(-1));
    }
    const response=await fetch(`${studioUrl}/api/render`,{method:'POST',body:form});
    assert.equal(response.status,202,await response.clone().text());
    const {jobId}=await response.json();
    let job;
    for(let i=0;i<900;i++){
      job=await (await fetch(`${studioUrl}/api/render/jobs/${jobId}`)).json();
      if(job.status!=='running')break;
      await delay(350);
    }
    assert.equal(job.status,'done',JSON.stringify(job));
    const file=await fetch(`${studioUrl}/api/render/jobs/${jobId}/file`);
    assert.equal(file.status,200);
    const mp4=join(out,'web-match.mp4');
    await writeFile(mp4,Buffer.from(await file.arrayBuffer()));
    const {streams}=JSON.parse(probe('-show_entries','stream=codec_name,width,height,nb_frames','-of','json',mp4));
    assert.equal(streams[0].codec_name,'h264');assert.equal(streams[0].width,1280);assert.equal(streams[0].height,720);
    assert.equal(Number(streams[0].nb_frames),endFrame-startFrame);assert.equal(streams[1]?.codec_name,'aac');
    const rgb=path=>ff('-i',path,'-pix_fmt','rgb24','-threads:v','1','-f','rawvideo','-');
    for(const frame of samples){
      const shot=join(out,`mp4-f${frame}.png`);
      ff('-i',mp4,'-vf',`select=eq(n\\,${frame-startFrame})`,'-frames:v','1','-threads:v','1',shot);
      const actual=rgb(shot),web=rgb(join(out,`index-f${frame}.png`)),preview=rgb(join(out,`studio-f${frame}.png`));
      function psnr(a,b){
        assert.equal(a.length,1280*720*3);assert.equal(b.length,a.length);
        let error=0;for(let i=0;i<a.length;i++)error+=(a[i]-b[i])**2;
        return 10*Math.log10(255**2/(error/a.length));
      }
      const studioScore=psnr(actual,preview),webScore=psnr(actual,web);
      console.log(`frame ${frame}: preview ${studioScore.toFixed(2)} dB; index.html ${webScore.toFixed(2)} dB`);
      assert.ok(studioScore>24 && webScore>24,'Web Match pixel comparison fell below tolerance');
    }
    console.log(`exported ${endFrame-startFrame} frames, H.264 + AAC`);
  }
  console.log(`Web Match verified: ${out}`);
}finally{
  await browser?.close();
  studio.close();studio.closeAllConnections();web.close();web.closeAllConnections();
}
