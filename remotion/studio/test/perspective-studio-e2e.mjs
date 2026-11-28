// Exercises the integrated Studio, not a synthetic React fixture.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';

const ff=(args,input)=>execFileSync('ffmpeg',['-v','error','-threads','1',...args],{input,maxBuffer:16*1024*1024});
const scratch=await mkdtemp(join(tmpdir(),'remain-perspective-studio-'));
const a=join(scratch,'wall.mp4'), b=join(scratch,'intro.mp4');
ff(['-f','lavfi','-i','color=#27272f:s=320x180:r=30:d=1,drawgrid=width=32:height=32:thickness=1:color=black','-c:v','libx264','-pix_fmt','yuv420p','-y',a]);
ff(['-f','lavfi','-i','color=#172035:s=320x180:r=30:d=0.5','-c:v','libx264','-pix_fmt','yuv420p','-y',b]);
let server,browser;
try {
  server=await startStudioServer({port:0,bindHost:'127.0.0.1',dev:true});
  browser=await chromium.launch({executablePath:(await ensureBrowser()).path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const btn=name=>page.getByRole('button',{name,exact:true});
  const tab=name=>page.getByRole('tab',{name,exact:true});
  await btn('Project video mới').click();
  await page.locator('#video-clips-file').setInputFiles([a,b]);
  await page.waitForFunction(()=>document.querySelector('#timeline')?.max==='44');
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  const aspect=page.getByRole('combobox',{name:'Khung hình'});
  await aspect.selectOption('wide');
  await tab('Lời').click();
  await page.locator('#lyrics').fill('[00:00.15]Wall\n[00:00.85]Song');
  await btn('Áp dụng lời').click();
  await page.getByRole('button',{name:/^Tua đến dòng 1: Wall/}).click();
  await tab('Hiệu ứng').click();
  await page.getByRole('combobox',{name:/Preset chữ/}).selectOption('classic');
  await btn('Gắn vào clip').click();
  await btn('Căn phối cảnh dòng').click();
  const stage=page.locator('.stage > div');
  const wall=stage.locator('[aria-label="Wall"]');
  await wall.waitFor();
  const frame=await stage.boundingBox(), center=await btn('Di chuyển khung').boundingBox();
  assert.ok(frame&&center);
  await page.mouse.move(center.x+center.width/2,center.y+center.height/2);await page.mouse.down();
  await page.mouse.move(center.x+center.width/2,center.y+center.height/2-frame.height*.18,{steps:6});await page.mouse.up();
  const handle=await btn('Góc trên trái').boundingBox();assert.ok(handle);
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+frame.width*.16,handle.y+handle.height/2-frame.height*.12,{steps:9});
  await page.mouse.up();
  await btn('Đặt lại phối cảnh').waitFor();
  const polygon=page.getByRole('group',{name:'Chỉnh phối cảnh video'}).locator('polygon');
  const points=await polygon.getAttribute('points');
  await page.setViewportSize({width:1366,height:830});
  assert.equal(await polygon.getAttribute('points'),points);
  await aspect.selectOption('tall');
  await page.getByText('Tỷ lệ khung đã đổi. Kiểm tra lại vị trí chữ phối cảnh.').waitFor();
  assert.equal(await polygon.getAttribute('points'),points);
  await aspect.selectOption('wide');
  await btn('Xong căn chữ').click();
  const clipSelect=page.getByRole('combobox',{name:'Clip video',exact:true});
  await clipSelect.selectOption({label:'1. wall.mp4'});
  await btn('Dời clip sang phải').click();
  await slider.fill('10');
  assert.equal(await wall.count(),0,'attached title must move off the song clock');
  await slider.fill('32');
  await wall.waitFor();
  await stage.locator('[aria-label="Song"]').waitFor();
  await slider.fill('30');
  await btn('Tách tại đầu phát').click();
  const motion=()=>wall.locator('[data-word-active]').first().evaluate(el=>el.style.transform);
  await slider.fill('29');const before=await motion();
  await slider.fill('30');const after=await motion();
  assert.notEqual(after,'translateY(76.5%)','effect must not restart after a clip split');
  await clipSelect.selectOption({label:'2. wall.mp4'});
  await page.getByLabel('Khung cuối',{exact:true}).fill('4');
  await btn('Áp dụng cắt').click();
  await slider.fill('30');
  assert.equal(await wall.count(),0,'trim hides the portion outside the kept frames');
  await btn('Hoàn tác').click();
  await slider.fill('29');await wall.waitFor();
  assert.equal(await motion(),before);
  // Compare the RGB location of the wall title (top region, outside the song
  // title) in paused preview and MP4 frames on either side of the split.
  const locateInk=bytes=>{
    let n=0,x=0,y=0;
    for(let j=0;j<90;j++)for(let i=0;i<160;i++){
      const k=(j*160+i)*3;
      if(j<39&&bytes[k]>130&&bytes[k+1]>95&&bytes[k+2]>60){n++;x+=i;y+=j;}
    }
    assert.ok(n>3,`expected visible ink, got ${n}`);
    return [x/n,y/n];
  };
  const samples=[];
  for(const at of [29,30]){
    await slider.fill(String(at));await wall.waitFor();
    await page.waitForTimeout(350);
    if(at===29&&process.env.STUDIO_ACCEPTANCE_DIR)await stage.screenshot({path:join(process.env.STUDIO_ACCEPTANCE_DIR,'remain-m2-preview.png')});
    const png=await stage.screenshot();
    samples.push(locateInk(ff(['-f','image2pipe','-i','-','-vf','scale=160:90,format=rgb24','-f','rawvideo','-'],png)));
  }
  assert.equal(await motion(),after);
  await page.getByRole('combobox',{name:/Phạm vi xuất/}).selectOption('range');
  await page.getByLabel('Bắt đầu (giây)').fill('0.9666666667');
  await page.getByLabel('Kết thúc (giây)').fill('1.0333333333');
  const download=page.waitForEvent('download',{timeout:100_000});
  await btn('Xuất MP4').click();
  const file=await (await download).path();
  const raw=ff(['-i',file,'-vf','scale=160:90,format=rgb24','-an','-f','rawvideo','-']);
  const stride=160*90*3;
  assert.equal(raw.length,stride*2);
  for(let i=0;i<2;i++){
    const actual=locateInk(raw.subarray(stride*i,stride*(i+1)));
    const expected=samples[i];
    assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<2,`frame ${29+i}: ${actual} vs ${expected}`);
  }
  assert.deepEqual(errors,[]);
  if(process.env.STUDIO_ACCEPTANCE_DIR)await copyFile(file,join(process.env.STUDIO_ACCEPTANCE_DIR,'remain-m2-perspective-cut.mp4'));
  console.log('Verified wall overlay, responsive normalized corners, aspect warning, scene reorder/split/trim/undo and preview-to-MP4 frame parity at the cut.');
} finally {
  await browser?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(scratch,{recursive:true,force:true});
}
