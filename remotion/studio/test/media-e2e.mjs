import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';

const base=process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:4317';
const scratch=await mkdtemp(join(tmpdir(),'remain-media-'));
let browser;
try {
  const audio=join(scratch,'long-track.mp3');
  const video=join(scratch,'background.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=32','-y',audio]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=30:d=2','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=4','-f','lavfi','-i','sine=frequency=660:duration=6','-filter_complex_threads','1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[out]','-map','[out]','-map','2:a','-c:v','libx264','-threads','1','-c:a','aac','-y',video]);
  const status=await ensureBrowser();
  assert.ok('path' in status,JSON.stringify(status));
  browser=await chromium.launch({executablePath:status.path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  const exportButton=page.getByRole('button',{name:'Xuất MP4',exact:true});
  assert.equal(await exportButton.getAttribute('data-slot'),'button');
  assert.equal(await page.locator('#lyrics').getAttribute('data-slot'),'textarea');
  assert.equal(await page.locator('#video-file').getAttribute('data-slot'),'input');
  const workspace=page.locator('.workspace');
  assert.equal(await workspace.evaluate(el=>getComputedStyle(el).display),'grid');
  assert.equal(await workspace.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  assert.equal(await page.getByLabel('Mốc đầu dòng (giây)').evaluate(el=>getComputedStyle(el.parentElement).display),'flex');
  assert.equal(await exportButton.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(240, 177, 92)');
  await page.locator('#audio-file').setInputFiles(audio);
  await page.locator('.filename').getByText('long-track.mp3',{exact:true}).waitFor();
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  assert.equal(await slider.getAttribute('max'),'959','Audio longer than 30 seconds must set the timeline length');
  await page.locator('#video-file').setInputFiles(video,{timeout:3500});
  await page.locator('.filename').getByText('background.mp4',{exact:true}).waitFor();
  await page.locator('.stage video').waitFor();
  assert.equal(await page.locator('.stage video').evaluate(el=>el.muted),true,'External audio replaces the video soundtrack');
  assert.equal(await slider.getAttribute('max'),'959');
  await page.locator('#lyrics').fill('[00:03.00]Cảnh màu xanh\n[00:05.00]Câu tiếp theo\n[00:31.00]Sau ba mươi giây');
  await page.getByRole('button',{name:'Áp dụng lời'}).click();
  const sync=page.getByRole('region',{name:'03 · Canh từng từ'});
  const follow=sync.getByRole('button',{name:'Theo video',exact:true});
  assert.equal(await follow.getAttribute('aria-pressed'),'true');
  await slider.fill('933');
  await page.locator('.stage [aria-label="Sau ba mươi giây"]').waitFor();
  await sync.locator('[aria-current="time"]').getByText('Sau',{exact:true}).waitFor();
  await slider.fill('105');
  await page.waitForFunction(()=>Math.abs(document.querySelector('.stage video')?.currentTime-3.5)<.12);
  await sync.locator('[aria-current="time"]').getByText('Cảnh',{exact:true}).waitFor();
  await sync.getByRole('button',{name:/^Cảnh /}).click();
  await slider.fill('933');
  await sync.getByRole('button',{name:/^Cảnh /,pressed:true}).waitFor();
  assert.equal(await follow.getAttribute('aria-pressed'),'false');
  await follow.click();
  await sync.locator('[aria-current="time"]').getByText('Sau',{exact:true}).waitFor();
  await slider.fill('141');
  await page.getByRole('button',{name:'Phát',exact:true}).click();
  await sync.locator('[aria-current="time"]').getByText('Câu',{exact:true}).waitFor({timeout:5000});
  await page.getByRole('button',{name:'Tạm dừng',exact:true}).click();
  if (process.env.STUDIO_SYNC_SCREENSHOT) {
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:process.env.STUDIO_SYNC_SCREENSHOT});
  }
  if (process.env.STUDIO_SYNC_MOBILE_SCREENSHOT) {
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:process.env.STUDIO_SYNC_MOBILE_SCREENSHOT});
    await page.setViewportSize({width:1440,height:900});
  }
  await page.getByLabel('Phạm vi xuất').selectOption('range');
  await page.getByLabel('Bắt đầu (giây)').fill('3');
  await page.getByLabel('Kết thúc (giây)').fill('5');
  assert.match(await page.locator('#render-duration').innerText(),/2\.00s/);
  await page.getByLabel('Kết thúc (giây)').fill('2');
  assert.equal(await page.getByRole('button',{name:'Xuất MP4',exact:true}).isDisabled(),true);
  await page.getByLabel('Kết thúc (giây)').fill('5');
  if (!process.env.STUDIO_PREVIEW_ONLY) {
    await page.getByRole('button',{name:'Gỡ nhạc'}).click();
    assert.equal(await slider.getAttribute('max'),'179');
    assert.equal(await page.locator('.stage video').evaluate(el=>el.muted),false);
    async function save(name) {
      const response=page.waitForResponse(r=>r.url().endsWith('/api/render') && r.request().method()==='POST',{timeout:360_000});
      const download=page.waitForEvent('download',{timeout:360_000});
      await page.getByRole('button',{name:'Xuất MP4',exact:true}).click();
      const result=await response;
      if (!result.ok()) throw Error(`Export HTTP ${result.status()}: ${await result.text()}`);
      const file=join(scratch,name);
      await (await download).saveAs(file);
      return file;
    }
    function meta(file) {
      return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'})).streams;
    }
    const part=await save('part.mp4');
    const rangeStreams=meta(part);
    assert.equal(rangeStreams.find(stream=>stream.codec_type==='video').nb_frames,'60');
    const pixel=execFileSync('ffmpeg',['-v','error','-ss','0.5','-i',part,'-vf','crop=2:2:10:10,scale=1:1,format=rgb24','-frames:v','1','-f','rawvideo','-']);
    assert.ok(pixel[2]>pixel[0]+90,`First exported scene should be blue, got RGB ${[...pixel]}`);
    const vol=execFileSync('ffmpeg',['-v','error','-i',part,'-f','s16le','-ac','1','-ar','8000','-']);
    assert.ok(vol.some(x=>x!==0),'Video soundtrack should be preserved');
    await page.getByLabel('Phạm vi xuất').selectOption('all');
    await page.locator('#audio-file').setInputFiles(audio);
    await page.locator('.filename').getByText('long-track.mp3',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Gỡ video'}).click();
    const full=await save('full.mp4');
    assert.equal(meta(full).find(stream=>stream.codec_type==='video').nb_frames,'960');
    console.log('Actual MP4s verified: selected blue section (60 frames, original video audio) and full long track (960 frames).');
  }
  assert.deepEqual(errors,[]);
  await page.setViewportSize({width:390,height:844});
  // The breakpoint swap changes min-height, and buttons carry `transition-all`: settle it before measuring touch targets.
  await page.evaluate(()=>document.getAnimations().forEach(animation=>animation.finish()));
  assert.equal(await workspace.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const markButton=sync.getByRole('button',{name:'Đóng dấu từ',exact:true});
  assert.ok((await markButton.boundingBox()).height>=44);
  assert.ok((await sync.boundingBox()).y<(await page.getByRole('heading',{name:'01 · Media'}).boundingBox()).y);
  await page.setViewportSize({width:320,height:740});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('Video-follow highlighting/seek, locked timing, video loading and 320px responsive layout verified.');
} finally {
  await browser?.close();
  await rm(scratch,{recursive:true,force:true});
}
