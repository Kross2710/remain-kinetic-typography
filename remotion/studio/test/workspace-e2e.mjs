import assert from 'node:assert/strict';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {ensureBrowser} from '@remotion/renderer';

const {path} = await ensureBrowser();
const browser = await chromium.launch({executablePath:path,args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1366,height:768}});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  const open = async () => {
    await page.goto(process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:4317');
    await page.getByRole('heading',{name:'Remain Studio'}).waitFor();
  };
  const tab = name => page.getByRole('tab',{name,exact:true});
  await open();
  assert.equal(await page.getByRole('tab').count(),5,'Inspector should have exactly five tabs');
  assert.equal(await tab('Canh từ').getAttribute('aria-selected'),'true');
  await tab('Lời').click();
  const lyrics = page.getByRole('textbox',{name:/Dán lời/});
  await lyrics.fill('Bản nháp chưa áp dụng');
  await tab('Canh từ').click();
  await page.getByRole('button',{name:/^nhịp /}).click();
  const slider = page.getByRole('slider',{name:'Vị trí timeline'});
  const frame = await slider.inputValue();
  const confirmed = await page.locator('.words [data-confirmed]').count();
  await tab('Canh từ').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.activeElement?.textContent==='Media');
  assert.equal(await tab('Canh từ').getAttribute('aria-selected'),'true','Arrows only move focus');
  await page.keyboard.press('t');
  await page.keyboard.press('Space');
  assert.equal(await tab('Media').getAttribute('aria-selected'),'true');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.activeElement?.textContent==='Lời');
  await page.keyboard.press('Enter');
  assert.equal(await lyrics.inputValue(),'Bản nháp chưa áp dụng');
  await lyrics.press('End');
  await lyrics.press('t');
  assert.equal(await lyrics.inputValue(),'Bản nháp chưa áp dụngt');
  await tab('Canh từ').click();
  assert.equal(await page.locator('.words [data-confirmed]').count(),confirmed);
  assert.equal(await slider.inputValue(),frame);
  await page.getByRole('button',{name:/^nhịp /,pressed:true}).waitFor();
  console.log('Inspector tabs: focus, Space/Enter, draft, selection and playhead verified.');

  const syncPanel=page.getByRole('tabpanel',{name:'Canh từ'});
  for (const control of [slider,page.getByLabel('Dòng đang canh')]) {
    await control.focus();
    await page.keyboard.press('t');
    assert.equal(await page.locator('.words [data-confirmed]').count(),confirmed,'A focused form control must not trigger tap');
  }
  await slider.focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.words [data-confirmed]').count(),confirmed,'Space on the scrubber must not trigger tap');

  for (const viewport of [{width:1366,height:768},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await open();
    for (const format of ['tall','wide']) {
      await page.getByRole('combobox',{name:/Khung hình/}).selectOption(format);
      await page.evaluate(()=>scrollTo(0,0));
      const bounds = await page.evaluate(()=>{
        return Object.fromEntries(['.play-toggle','.tap','.lyric-track'].map(selector=>{
          const el = document.querySelector(selector);
          const r = el.getBoundingClientRect();
          return [selector,{top:r.top,bottom:r.bottom,visible:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}];
        }));
      });
      for (const [key,box] of Object.entries(bounds)) {
        assert.ok(box.top>=0 && box.bottom<=viewport.height && box.visible,`${viewport.width}×${viewport.height} ${format} ${key}: ${JSON.stringify(box)}`);
      }
      const preview = await page.locator('.stage > div').boundingBox();
      const ratio = format==='tall'?9/16:16/9;
      assert.ok(Math.abs(preview.width/preview.height-ratio)<.02,'Preview should keep its composition aspect ratio');
      if (process.env.STUDIO_WORKSPACE_SHOTS) {
        await slider.fill('60');
        await page.screenshot({path:join(process.env.STUDIO_WORKSPACE_SHOTS,`${viewport.width}-${format}.png`)});
      }
      console.log(`${viewport.width}×${viewport.height} ${format}: preview controls and cue lane visible`,bounds);

      await tab('Lời').click();
      await lyrics.fill('[00:00.00]Đầu\n[00:05.00]Nhịp\n[00:12.00]Cuối');
      await page.getByRole('button',{name:'Áp dụng lời'}).click();
      await tab('Canh từ').click();
      const targetCue=page.getByRole('button',{name:/Tua đến dòng 2: Nhịp/});
      await targetCue.click();
      assert.equal(await slider.inputValue(),'150');
      assert.equal(await tab('Canh từ').getAttribute('aria-selected'),'true');
      await page.getByRole('button',{name:/^Nhịp /,pressed:true}).waitFor();
      await page.getByRole('button',{name:'Phát',exact:true}).click();
      if (viewport.width===1366) {
        await tab('Canh từ').focus();
        await page.keyboard.press('Tab');
        assert.equal(await syncPanel.evaluate(el=>el===document.activeElement),true);
      }
      await page.keyboard.press(format==='tall'?'Space':'t');
      const completeCue=page.getByRole('button',{name:/Tua đến dòng 2: Nhịp.*Đã canh xong/i});
      await completeCue.waitFor();
      assert.equal(await completeCue.getAttribute('aria-current'),'time');
      await page.getByRole('button',{name:'Tạm dừng',exact:true}).click();
      await page.keyboard.press('Control+z');
      assert.equal(await completeCue.count(),0);
      await page.keyboard.press('Control+Shift+z');
      await completeCue.waitFor();
      assert.equal(await page.evaluate(()=>scrollY),0,'Cue selection, playback, tap and history must not scroll the page');
      console.log(`${viewport.width}×${viewport.height} ${format}: cue selection, tap, live/completed and undo/redo verified`);
    }
  }
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
}
