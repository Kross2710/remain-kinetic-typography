// End-to-end proof of the browser session: a reload must keep the lyrics, the
// word marks, the render range and the two media files, and a render that was
// already running must be picked up again and still deliver its MP4.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';

const base=process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:4317';
const scratch=await mkdtemp(join(tmpdir(),'remain-session-'));
let browser;
try {
  const audio=join(scratch,'dai.mp3');
  const video=join(scratch,'nen.mp4');
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=32','-y',audio]);
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=6','-f','lavfi','-i','sine=frequency=660:duration=6','-filter_complex_threads','1','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-c:a','aac','-y',video]);
  const status=await ensureBrowser();
  assert.ok('path' in status,JSON.stringify(status));
  browser=await chromium.launch({executablePath:status.path,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const openTab=name=>page.getByRole('tab',{name,exact:true}).click();
  const slider=page.getByRole('slider',{name:'Vị trí timeline'});
  const exportButton=page.getByRole('button',{name:'Xuất MP4',exact:true});
  const savedLabel=()=>page.getByRole('tabpanel').getByText(/^đã tự lưu lúc /).count();

  await page.goto(base);
  await exportButton.waitFor();
  await openTab('Media');
  // A fresh browser must start without media, otherwise this test proves nothing.
  assert.equal(await page.locator('.filename').count(),0,'a fresh Studio must not restore media');
  await page.locator('#audio-file').setInputFiles(audio);
  await page.locator('.filename').getByText('dai.mp3',{exact:true}).waitFor();
  await page.locator('#video-file').setInputFiles(video);
  await page.locator('.filename').getByText('nen.mp4',{exact:true}).waitFor();
  assert.equal(await slider.getAttribute('max'),'959');

  await openTab('Lời');
  await page.locator('#lyrics').fill('[00:03.00]Cảnh màu xanh\n[00:05.00]Câu tiếp theo');
  await page.getByRole('button',{name:'Áp dụng lời'}).click();

  // Tap one word so a confirmed mark has to survive the reload.
  await openTab('Canh từ');
  const sync=page.getByRole('region',{name:'Canh từng từ'});
  await slider.fill('105');
  const beforeMark=await sync.getByText(/^Sắp chấm: /).innerText();
  // The tap key is ignored while an input holds focus, so press it from the panel.
  await page.locator('.sync-tab').press('t');
  const afterMark=await sync.getByText(/^Sắp chấm: /).innerText();
  assert.notEqual(afterMark,beforeMark,'tapping must move to the next word');

  await page.getByLabel('Phạm vi xuất').selectOption('range');
  await page.getByLabel('Bắt đầu (giây)').fill('3');
  await page.getByLabel('Kết thúc (giây)').fill('5');
  await openTab('Project');
  await page.getByText(/^đã tự lưu lúc /).waitFor({timeout:10_000});
  // The autosave is debounced: reload only after the last edit has landed.
  await page.waitForTimeout(900);

  await page.reload();
  await exportButton.waitFor();

  await openTab('Media');
  await page.locator('.filename').getByText('dai.mp3',{exact:true}).waitFor({timeout:10_000});
  await page.locator('.filename').getByText('nen.mp4',{exact:true}).waitFor({timeout:10_000});
  assert.equal(await page.locator('.stage video').count(),1,'the restored video must play in the preview');
  assert.equal(await slider.getAttribute('max'),'959','the restored media must restore the timeline length');

  await openTab('Lời');
  const lyrics=await page.locator('#lyrics').inputValue();
  assert.ok(lyrics.includes('Cảnh màu xanh') && lyrics.includes('Câu tiếp theo'),'the lyrics must come back');

  await openTab('Canh từ');
  assert.equal(await sync.getByText(/^Sắp chấm: /).innerText(),afterMark,'the tapped word mark must come back');

  assert.equal(await page.getByLabel('Phạm vi xuất').inputValue(),'range');
  assert.equal(await page.getByLabel('Bắt đầu (giây)').inputValue(),'3');
  assert.equal(await page.getByLabel('Kết thúc (giây)').inputValue(),'5');
  await openTab('Project');
  assert.equal(await savedLabel(),1,'the restored session must report itself');

  const segmentDownload=page.waitForEvent('download',{timeout:360_000});
  await exportButton.click();
  await page.locator('.render-progress').waitFor({timeout:30_000});
  const segment=join(scratch,'segment.mp4');
  await (await segmentDownload).saveAs(segment);
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',segment],{encoding:'utf8'})).streams;
  assert.equal(streams.find(s=>s.codec_type==='video').nb_frames,'60','the restored range must still export the same 2 seconds');
  assert.ok(streams.some(s=>s.codec_type==='audio'),'the restored audio blob must still be usable');

  // A render that is running when the page goes away must come back as a job.
  await page.getByLabel('Phạm vi xuất').selectOption('range');
  await page.getByLabel('Bắt đầu (giây)').fill('0');
  await page.getByLabel('Kết thúc (giây)').fill('4');
  // Let the autosave land first: the resumed render must use the saved range.
  await page.waitForTimeout(900);
  const resumedDownload=page.waitForEvent('download',{timeout:360_000});
  await exportButton.click();
  await page.locator('.render-progress').waitFor({timeout:30_000});
  await page.reload();
  await exportButton.waitFor();
  await page.locator('.render-progress').waitFor({timeout:30_000});
  const bar=await page.locator('.render-progress progress').getAttribute('value');
  assert.ok(Number(bar)>0,`the re-attached bar must show progress, got ${bar}`);
  const resumed=join(scratch,'resumed.mp4');
  await (await resumedDownload).saveAs(resumed);
  const resumedStreams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',resumed],{encoding:'utf8'})).streams;
  assert.equal(resumedStreams.find(s=>s.codec_type==='video').nb_frames,'120');

  // Starting over must clear the browser session, not just the screen.
  await openTab('Project');
  await page.getByRole('button',{name:'Bắt đầu lại',exact:true}).click();
  await page.locator('.filename').getByText('dai.mp3',{exact:true}).waitFor({state:'detached',timeout:10_000});
  await page.reload();
  await exportButton.waitFor();
  await openTab('Media');
  assert.equal(await page.locator('.filename').count(),0,'Bắt đầu lại must clear the stored media too');
  await openTab('Lời');
  assert.ok((await page.locator('#lyrics').inputValue()).includes('Một nhịp thở'),'Bắt đầu lại must return to the demo project');

  assert.deepEqual(errors,[]);
  console.log('Session verified: reload kept lyrics, word marks, range, timeline length and both media files; a running render survived a reload and exported 60 and 120 frame MP4s; Bắt đầu lại cleared the browser session.');
} finally {
  await browser?.close();
  await rm(scratch,{recursive:true,force:true});
}
