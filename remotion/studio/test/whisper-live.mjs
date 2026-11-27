// Run from remotion/: node studio/test/whisper-live.mjs [output-directory] [baseline|verify]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {PRESETS} from '../effects.mjs';
import {FPS, importLyrics} from '../project.mjs';
import {startStudioServer} from '../server.mjs';

const out=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(tmpdir(),'remain-whisper-'));
const mode=process.argv[3] ?? 'verify';
assert.ok(['baseline','verify'].includes(mode));
await mkdir(out,{recursive:true});
const lrc=await readFile(new URL('../../../assets/lyrics/remain.enhanced.lrc',import.meta.url),'utf8');
const project={version:1,width:720,height:1280,durationInFrames:2160,cues:importLyrics(lrc.split('\n').slice(5,9).join('\n'),2160/FPS),renderRange:{startFrame:1859,endFrame:1931}};
const hookIndex=2;
assert.match(project.cues[hookIndex].text,/will remain/);
const samples=[1863,1865,1888,1920];
const legacyGolden=await access(join(out,`classic-f${samples[0]}.png`)).then(()=>true,error=>{
  if(error.code!=='ENOENT')throw error;
  return false;
});
const audio=await readFile(new URL('../../../assets/audio/clip.mp3',import.meta.url));
const server=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
const base=`http://127.0.0.1:${server.address().port}`;
const ff=(...args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{maxBuffer:4*1024*1024});
const probe=(...args)=>execFileSync('ffprobe',['-v','error',...args],{encoding:'utf8'});
let browser;
try {
  const runtime=await ensureBrowser();
  browser=await chromium.launch({executablePath:runtime.path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1720,height:1600},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  const tab=name=>page.getByRole('tab',{name,exact:true}).click();
  const stage=page.locator('.stage');
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  await page.addStyleTag({content:'.stage.stage { width:720px !important; max-width:none !important; height:1280px !important; max-height:none !important; margin:0 !important; border:0 !important; border-radius:0 !important; }'});
  const active=page.locator('[data-lyric-preset]');
  const load=async (p)=>{
    await tab('Project');
    await page.locator('#project-file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
    await page.getByText('Đã nạp fixture.json',{exact:false}).waitFor();
  };
  const seek=async frame=>{
    await slider.fill(String(frame));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await slider.inputValue(),String(frame));
  };
  async function preview(label, frames, legacy=false) {
    for(const frame of frames){
      await seek(frame);
      const file=join(out,`${label}-f${frame}.png`);
      const shot=await stage.screenshot(legacy?{}:{path:file});
      if(legacy) assert.deepEqual(shot,await readFile(file),`${label} preview changed at ${frame}`);
    }
  }
  async function render(label,p){
    const data=new FormData();
    data.set('project',JSON.stringify(p));
    data.set('audio',new Blob([audio],{type:'audio/mpeg'}),'clip.mp3');
    const start=performance.now();
    const response=await fetch(`${base}/api/render`,{method:'POST',body:data});
    assert.equal(response.status,202,await response.clone().text());
    const id=(await response.json()).jobId;
    let job;
    do {
      await delay(250);
      job=await (await fetch(`${base}/api/render/jobs/${id}`)).json();
    }while(job.status==='running' && performance.now()-start<240000);
    assert.equal(job.status,'done',JSON.stringify(job));
    const elapsed=(performance.now()-start)/1000;
    const file=await fetch(`${base}/api/render/jobs/${id}/file`);
    assert.equal(file.status,200);
    const path=join(out,`${label}.mp4`);
    await writeFile(path,Buffer.from(await file.arrayBuffer()));
    const {streams}=JSON.parse(probe('-show_entries','stream=codec_name,width,height,nb_frames','-of','json',path));
    const frames=p.renderRange.endFrame-p.renderRange.startFrame;
    const {codec_name,width,height,nb_frames}=streams[0];
    assert.deepEqual({codec_name,width,height,nb_frames},{codec_name:'h264',width:p.width,height:p.height,nb_frames:String(frames)});
    assert.equal(streams[1]?.codec_name,'aac');
    console.log(`${label}: ${frames} frames, ${elapsed.toFixed(2)} s, ${(frames/elapsed).toFixed(2)} fps (end-to-end)`);
    return path;
  }
  await tab('Media');
  await page.locator('#audio-file').setInputFiles({name:'clip.mp3',mimeType:'audio/mpeg',buffer:audio});
  await page.waitForFunction(()=>Number(document.querySelector('input[aria-label="Vị trí timeline"]')?.max)>=1931);
  if(mode==='baseline'){
    for(const preset of ['classic','aurora']){
      const p={...project,effect:PRESETS[preset]};
      await load(p);
      await preview(preset,samples);
      await render(preset,p);
    }
  }else{
    await tab('Hiệu ứng');
    assert.equal(await page.getByLabel('Preset chữ').inputValue(),'whisper','Fresh Studio must default to Whisper');
    if(legacyGolden) for(const preset of ['classic','aurora']){
      await load({...project,effect:PRESETS[preset]});
      await preview(preset,samples,true);
    }
    await load(project);
    await seek(1888);
    assert.equal(await active.getAttribute('data-lyric-preset'),'classic','Legacy preset-less file must remain Classic');
    const p={...project,effect:PRESETS.whisper};
    await load(p);
    await seek(1865);
    await tab('Hiệu ứng');
    const hook=page.getByRole('button',{name:/Đánh dấu hook|Bỏ dấu hook/});
    await hook.click();
    assert.equal(await hook.getAttribute('aria-pressed'),'true');
    assert.ok(await active.locator('[data-whisper-letter]').count()>1);
    await tab('Project');
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Lưu project',exact:true}).click();
    const saved=join(out,'whisper.project.json');
    await (await downloaded).saveAs(saved);
    const loaded=JSON.parse(await readFile(saved,'utf8'));
    assert.equal(loaded.cues[hookIndex].hook,true);
    assert.equal(loaded.cues[hookIndex-1].hook,undefined);
    await load({...p,cues:loaded.cues});
    await seek(1864);
    assert.equal(await active.locator('[data-whisper-letter]').count(),0);
    const lastPose=await active.evaluate(el=>el.style.transform);
    await seek(1865);
    const outgoing=page.locator('[data-whisper-past]');
    assert.equal(await outgoing.count(),2);
    assert.equal(await outgoing.last().locator('[data-outgoing-lyric]').evaluate(el=>el.style.transform),lastPose);
    const background=page.locator('[data-whisper-atmosphere]');
    assert.equal(await background.count(),1);
    await seek(1888);
    const pose=()=>active.evaluate(el=>el.style.transform);
    const at1888=await pose();
    await seek(1920);
    assert.notEqual(await pose(),at1888);
    await seek(1888);
    assert.equal(await pose(),at1888);
    await page.addStyleTag({content:'.stage.stage { padding:0 !important; } .stage.stage > div { max-width:none !important; border:0 !important; box-shadow:none !important; }'});
    await preview('whisper-preview',samples);
    const makeCue=(text,start,override)=>({text,start,words:[{text,start}],...(override?{effect:override}:{})});
    await load({...p,cues:[makeCue('First',0),makeCue('Second',.2),makeCue('Third',.4),makeCue('Fourth',.6,PRESETS.aurora)]});
    await seek(18);
    const trail=page.locator('[data-outgoing-lyric]');
    assert.deepEqual(await trail.allTextContents(),['Second','Third'],'Aurora handoff must not resurrect a third Whisper cue');
    await load({...p,cues:[makeCue('Whisper',0),makeCue('Aurora',31/30,PRESETS.aurora)]});
    await seek(30);
    const poseBefore=await active.evaluate(el=>el.style.transform);
    await seek(31);
    assert.equal(await trail.evaluate(el=>el.style.transform),poseBefore,'Mixed preset handoff must sample the last visible frame');
    const mp4=await render('whisper',{...p,cues:loaded.cues});
    for(const frame of samples){
      const file=join(out,`whisper-mp4-f${frame}.png`);
      ff('-i',mp4,'-vf',`select=eq(n\\,${frame-p.renderRange.startFrame})`,'-frames:v','1','-threads:v','1',file);
      const rgb=path=>ff('-i',path,'-pix_fmt','rgb24','-threads:v','1','-f','rawvideo','-');
      const actual=rgb(file), expected=rgb(join(out,`whisper-preview-f${frame}.png`));
      assert.equal(expected.length,720*1280*3);
      assert.equal(actual.length,expected.length);
      let error=0;
      for(let i=0;i<actual.length;i++) error+=(actual[i]-expected[i])**2;
      const psnr=10*Math.log10(255**2/(error/actual.length));
      console.log(`frame ${frame}: preview / MP4 ${psnr.toFixed(2)} dB`);
      assert.ok(psnr>30,`Preview/MP4 mismatch at frame ${frame}`);
    }
  }
  assert.deepEqual(errors,[]);
  console.log(`Studio ${mode}: ${out}`);
} finally {
  await browser?.close();
  server.close();
  server.closeAllConnections();
}
