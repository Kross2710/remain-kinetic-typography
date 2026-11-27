// Run from remotion/: node studio/test/shared-motion-live.mjs [artifact directory]
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {PRESETS} from '../effects.mjs';
import {startStudioServer} from '../server.mjs';

const out=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(tmpdir(),'remain-shared-motion-'));
await mkdir(out,{recursive:true});
const line=(text,starts)=>({text,start:starts[0],words:text.split(' ').map((text,i)=>({text,start:starts[i]}))});
const project={version:1,width:720,height:1280,durationInFrames:900,effect:PRESETS.classic,cues:[
  line('Lời đang ngân',[0,.7,1.4]),line('But I will remain, love',[2.5,2.9,3.3,3.7,4.5]),line('Một câu tiếp theo',[5.8,6.2,6.5,7]),
]};
const server=process.env.STUDIO_TEST_URL?null:await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
const base=process.env.STUDIO_TEST_URL ?? `http://127.0.0.1:${server.address().port}`;
const ff=(...args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{maxBuffer:4*1024*1024});
let browser;
try{
  const {path}=await ensureBrowser();
  browser=await chromium.launch({executablePath:path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1720,height:1600},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  const tab=name=>page.getByRole('tab',{name,exact:true}).click();
  const load=async (name,p)=>{
    await tab('Project');
    await page.locator('#project-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
    await page.getByText(`Đã nạp ${name}`,{exact:false}).waitFor();
  };
  await load('fixture.json',project);
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  const current=page.locator('[data-lyric-preset]');
  const stage=page.locator('.stage');
  await page.addStyleTag({content:'.stage.stage {width:720px!important;height:1280px!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;border-radius:0!important;padding:0!important}.stage.stage > div {max-width:none!important;border:0!important;box-shadow:none!important}'});
  async function seek(frame){
    await slider.fill(String(frame));
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await slider.inputValue(),String(frame));
  }
  await tab('Hiệu ứng');
  const preset=page.getByLabel('Preset chữ');
  const scope=page.getByLabel('Phạm vi hiệu ứng');
  const panel=page.getByRole('group',{name:'Hiệu ứng dùng chung'});
  const checkboxes=panel.getByRole('checkbox');
  assert.equal(await checkboxes.count(),4);
  assert.equal(await checkboxes.and(page.locator(':checked')).count(),0);
  for(const option of await checkboxes.all())await option.check();
  await seek(9);
  assert.equal(await current.getAttribute('data-shared-entry'),'true');
  const fill=Number(await current.locator('[data-motion-wipe]').nth(1).getAttribute('data-motion-wipe'));
  assert.ok(fill>0 && fill<1,'Partial fill in the second grapheme');
  await preset.selectOption('aurora');
  assert.equal(await current.getAttribute('data-lyric-preset'),'aurora');
  assert.equal(await checkboxes.and(page.locator(':checked')).count(),4);
  await preset.selectOption('web-match');
  await page.frameLocator('iframe[data-web-match]').locator('html[data-web-match-frame]').waitFor();
  assert.equal(await panel.count(),0);
  await preset.selectOption('whisper');
  assert.equal(await checkboxes.and(page.locator(':checked')).count(),4);
  await seek(78);
  assert.equal(await current.getAttribute('data-lyric-preset'),'whisper');
  assert.ok(await current.locator('[data-motion-ink]').count()>0);
  assert.equal(await current.locator('[data-held-glyph]').first().evaluate(el=>el.style.opacity),'0');
  const scroll=page.locator('[data-flow-offset]');
  const firstOffset=await scroll.getAttribute('data-flow-offset');
  await seek(103);
  const secondOffset=await scroll.getAttribute('data-flow-offset');
  assert.ok(Number(secondOffset)<Number(firstOffset),'The whole lyric column should scroll upward');
  assert.equal(await page.locator('[data-flow-past]').count(),1);
  await seek(78);
  assert.equal(await scroll.getAttribute('data-flow-offset'),firstOffset,'Flow must be deterministic when seeking back');
  await seek(143);
  assert.ok(Number(await current.locator('[data-held-glyph]').first().evaluate(el=>el.style.opacity))>0,'Held word becomes visible when sung');
  await scope.selectOption('line');
  const wipe=panel.getByRole('combobox',{name:/Karaoke/});
  await wipe.selectOption('off');
  assert.equal(await current.locator('[data-motion-wipe]').count(),0);
  await wipe.selectOption('inherit');
  assert.ok(await current.locator('[data-motion-wipe]').count()>0);
  await wipe.selectOption('off');
  await scope.selectOption('project');
  await preset.selectOption('classic');
  assert.equal(await current.getAttribute('data-lyric-preset'),'classic','A line-only motion override must not pin its preset');
  await seek(15);
  assert.ok(await current.locator('[data-motion-wipe]').count()>0,'Other lines inherit the project wipe');
  await tab('Project');
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Lưu project',exact:true}).click();
  const file=join(out,'shared-motion.project.json');
  await (await downloading).saveAs(file);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(saved.effect.motion,{enter:true,wipe:true,ink:true,flow:true});
  assert.deepEqual(saved.cues[1].motion,{wipe:false});
  assert.equal(saved.cues[1].effect,undefined);
  await load('restored.json',saved);
  await seek(90);
  assert.equal(await current.locator('[data-motion-wipe]').count(),0);
  assert.ok(await current.locator('[data-motion-ink]').count()>0);
  await tab('Hiệu ứng');
  await scope.selectOption('line');
  await wipe.selectOption('inherit');
  // The export fixture matches the picture on the preview, after inheriting.
  const mix={...saved,cues:saved.cues.map(({motion,...cue})=>cue),renderRange:{startFrame:72,endFrame:150}};
  const samples=[74,82,103,143];
  for(const frame of samples){
    await seek(frame);
    await stage.screenshot({path:join(out,`shared-preview-${frame}.png`),style:'.inspector,.transport,.topbar{visibility:hidden!important}'});
  }
  assert.deepEqual(errors,[]);
  if(!process.env.STUDIO_PREVIEW_ONLY){
    const form=new FormData();
    form.set('project',JSON.stringify(mix));
    const audio=await readFile(new URL('../../../assets/audio/clip.mp3',import.meta.url));
    form.set('audio',new Blob([audio],{type:'audio/mpeg'}),'clip.mp3');
    const response=await fetch(`${base}/api/render`,{method:'POST',body:form});
    assert.equal(response.status,202,await response.clone().text());
    const {jobId}=await response.json();
    let job;
    for(let i=0;i<900;i++){
      job=await (await fetch(`${base}/api/render/jobs/${jobId}`)).json();
      if(job.status!=='running')break;
      await delay(300);
    }
    assert.equal(job.status,'done',JSON.stringify(job));
    const video=await fetch(`${base}/api/render/jobs/${jobId}/file`);
    assert.equal(video.status,200);
    const mp4=join(out,'shared-motion.mp4');
    await writeFile(mp4,Buffer.from(await video.arrayBuffer()));
    const {streams}=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,width,height,nb_frames','-of','json',mp4],{encoding:'utf8'}));
    const {codec_name,width,height,nb_frames}=streams[0];
    assert.deepEqual({codec_name,width,height,nb_frames},{codec_name:'h264',width:720,height:1280,nb_frames:'78'});
    assert.equal(streams[1]?.codec_name,'aac');
    const rgb=path=>ff('-i',path,'-pix_fmt','rgb24','-threads:v','1','-f','rawvideo','-');
    for(const frame of samples){
      const png=join(out,`shared-mp4-${frame}.png`);
      ff('-i',mp4,'-vf',`select=eq(n\\,${frame-mix.renderRange.startFrame})`,'-frames:v','1','-threads:v','1',png);
      const actual=rgb(png),preview=rgb(join(out,`shared-preview-${frame}.png`));
      assert.equal(actual.length,720*1280*3);assert.equal(preview.length,actual.length);
      let error=0;
      for(let i=0;i<actual.length;i++)error+=(actual[i]-preview[i])**2;
      const psnr=10*Math.log10(255**2/(error/actual.length));
      assert.ok(psnr>30,`Preview/MP4 differ on frame ${frame}: ${psnr.toFixed(2)} dB`);
      console.log(`frame ${frame}: ${psnr.toFixed(2)} dB`);
    }
  }
  console.log(`Shared effects verified on Classic, Aurora and Whisper: ${out}`);
}finally{
  await browser?.close();server?.close();server?.closeAllConnections();
}
