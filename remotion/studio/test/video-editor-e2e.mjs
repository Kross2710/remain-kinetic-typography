import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';

const scratch=await mkdtemp(join(tmpdir(),'remain-video-e2e-'));
const ff=args=>execFileSync('ffmpeg',['-v','error',...args],{maxBuffer:8*1024*1024});
const fixtures=[['red',660],['lime',770],['blue',880]].map(([color,pitch])=>{
  const path=join(scratch,`${color}.mp4`);
  ff(['-f','lavfi','-i',`color=${color}:s=160x90:r=30:d=1`,'-f','lavfi','-i',`sine=f=${pitch}:d=1`,'-c:v','libx264','-threads','1','-c:a','aac','-y',path]);
  return path;
});
const audio=join(scratch,'music.wav');
ff(['-f','lavfi','-i','sine=f=440:d=5','-y',audio]);
const server=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
let browser;
try {
  const status=await ensureBrowser();
  assert.ok('path' in status,JSON.stringify(status));
  browser=await chromium.launch({executablePath:status.path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Project video mới',exact:true}).click({timeout:5000});
  await page.locator('#video-clips-file').setInputFiles(fixtures);
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  await page.waitForFunction(()=>document.querySelector('#timeline')?.max==='89');
  const clips=page.locator('.video-track .video-edit-clip-select');
  assert.equal(await clips.count(),3);
  await page.locator('#audio-file').setInputFiles(audio);
  await page.getByText('music.wav',{exact:true}).first().waitFor();
  assert.equal(await slider.getAttribute('max'),'89','Music must not extend a video project');
  await page.getByLabel('Khung đầu',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Áp dụng cắt',exact:true}).click();
  assert.equal(await slider.getAttribute('max'),'84');
  await slider.fill('10');
  await page.getByRole('button',{name:'Tách tại đầu phát',exact:true}).click();
  assert.deepEqual(await clips.allTextContents(),['red.mp4','red.mp4','lime.mp4','blue.mp4']);
  const first=await clips.first().boundingBox(), green=await clips.nth(2).boundingBox();
  assert.ok(first&&green);
  await page.mouse.move(green.x+green.width/2,green.y+green.height/2);
  await page.mouse.down();
  await page.mouse.move(first.x+first.width/2,green.y+green.height/2,{steps:12});
  await page.mouse.up();
  assert.deepEqual(await clips.allTextContents(),['lime.mp4','red.mp4','red.mp4','blue.mp4']);
  await page.getByRole('button',{name:'Bật tiếng clip',exact:true}).click();
  await clips.last().click();
  await page.getByRole('button',{name:'Xóa clip',exact:true}).click();
  assert.equal(await slider.getAttribute('max'),'54');
  await page.getByRole('button',{name:'Hoàn tác',exact:true}).click();
  assert.equal(await slider.getAttribute('max'),'84');
  await page.getByRole('tab',{name:'Project',exact:true}).click();
  const saved=page.waitForEvent('download');
  await page.getByRole('button',{name:'Lưu project',exact:true}).click();
  const jsonPath=await (await saved).path();
  const json=JSON.parse(await readFile(jsonPath,'utf8'));
  assert.deepEqual(json.cues,[]);
  assert.deepEqual(json.videoTrack.map(({name,inFrame,outFrame,muted})=>[name,inFrame,outFrame,muted]),[
    ['lime.mp4',0,30,false],['red.mp4',5,15,true],['red.mp4',15,30,true],['blue.mp4',0,30,true],
  ]);
  // Reload exercises IndexedDB restoration; the portable JSON path below
  // deliberately opens in a fresh browser context with no source blobs.
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#timeline')?.max==='84');
  assert.deepEqual(await clips.allTextContents(),['lime.mp4','red.mp4','red.mp4','blue.mp4']);
  const exportButton=page.getByRole('button',{name:'Xuất MP4',exact:true});
  assert.equal(await exportButton.isEnabled(),true);
  const exported=page.waitForEvent('download',{timeout:120_000});
  await exportButton.click();
  const mp4=await (await exported).path();
  const {streams}=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',mp4]));
  assert.deepEqual(streams.map(s=>s.codec_name),['h264','aac']);
  assert.equal(Number(streams[0].nb_frames),85);
  assert.ok(Math.abs(Number(streams[0].duration)-85/30)<.001);
  const rgb=ff(['-i',mp4,'-vf','crop=2:2:360:640,scale=1:1,format=rgb24','-an','-f','rawvideo','-']);
  const colors=Array.from({length:85},(_,i)=>[...rgb.subarray(i*3,i*3+3)].map(x=>Number(x>190)));
  assert.deepEqual(colors,[...Array(30).fill([0,1,0]),...Array(25).fill([1,0,0]),...Array(30).fill([0,0,1])]);
  const pcm=ff(['-i',mp4,'-vn','-ac','1','-ar','48000','-f','s16le','-']);
  const amplitude=(freq,from,to)=>{
    let re=0,im=0;
    for(let i=from;i<to;i++){
      const s=pcm.readInt16LE(i*2)/32768, w=2*Math.PI*freq*i/48000;
      re+=s*Math.cos(w);im+=s*Math.sin(w);
    }
    return 2*Math.hypot(re,im)/(to-from);
  };
  assert.ok(amplitude(440,4800,36000)>.04&&amplitude(770,4800,36000)>.04,'Music and enabled clip audio must mix');
  assert.ok(amplitude(440,52000,78000)>.04&&amplitude(660,52000,78000)<.01,'Muted clip must not replace music');
  const missing=await browser.newPage();
  await missing.goto(page.url());
  await missing.locator('#project-file').setInputFiles(jsonPath);
  await missing.waitForFunction(()=>document.querySelector('#timeline')?.max==='84');
  assert.equal(await missing.getByRole('button',{name:'Xuất MP4',exact:true}).isDisabled(),true);
  await missing.locator('#audio-file').setInputFiles(audio);
  for(const clip of [json.videoTrack[0],json.videoTrack[1],json.videoTrack[3]]) {
    await missing.getByRole('combobox',{name:'Clip video',exact:true}).selectOption(clip.id);
    await missing.locator(`[data-video-media-id="${clip.mediaId}"]`).setInputFiles(fixtures.find(file=>file.endsWith('/'+clip.name)));
    await missing.locator(`[data-video-media-id="${clip.mediaId}"]`).waitFor({state:'detached'});
  }
  assert.equal(await missing.getByRole('button',{name:'Xuất MP4',exact:true}).isEnabled(),true);
  assert.deepEqual(errors,[]);
  if(process.env.STUDIO_ACCEPTANCE_DIR)await copyFile(mp4,join(process.env.STUDIO_ACCEPTANCE_DIR,'remain-m1-three-clips.mp4'));
  console.log('Verified three sources, ripple trim/split/reorder/delete/undo, local reload/relink and an 85-frame lyrics-free H.264/AAC export with exact cuts and mixed audio.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}
