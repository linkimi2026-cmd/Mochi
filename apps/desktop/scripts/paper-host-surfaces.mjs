import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Real DSH/campus frontend; every campus API response below is synthetic test data. */
export async function checkHostSurfaces(page, evidence) {
  const shot = async name => { if (evidence) await page.screenshot({ path: join(evidence, name + '.png') }); };
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  for (const [label, id] of [['通用设置','general'],['模型','models'],['插件','plugins'],['Agent 预设','agents'],['侧边卡片','sidebar']]) {
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(150);
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 2), `${label} has no horizontal overflow`);
    await shot('live-settings-' + id);
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  const now = '2026-09-27T08:30:00.000Z';
  const student = { id: 901, code:'TEST-0901', name:'示例学生', gender:'未知',grade:'高一',className:'示例班',visitCount:1 };
  const row = { groupKey:'sample',groupLabel:'示例班',studentCount:40,movementTotal:2,normalCompleted:1,arrivalOverdue:0,returnOverdue:0,unapprovedArrival:0,dormLate:0,medicalEvents:1,activeMovements:1 };
  const analytics = { level:'CLASS',items:[row],totalCount:1,truncated:false,daily:[{day:'2026-09-27',movementTotal:2,closedTotal:1}],periodStart:'2026-09-14',periodEnd:'2026-09-27',serverTime:now };
  const event = { id:901,studentName:student.name,studentCode:student.code,className:student.className,category:'OTHER',urgency:'NORMAL',status:'OBSERVING',visitedAt:now,updatedAt:now,acknowledged:0 };
  let signedIn = true;
  const unknown = new Set();
  const route = async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/jxl-api','');
    let data;
    let status = 200;
    if (path === '/auth/me') {
      if (!signedIn) { status=401; data={error:'请先登录',code:'UNAUTHENTICATED'}; }
      else data={user:{id:901,username:'ui-fixture',name:'示例老师',role:'HEAD_TEACHER',gradeScope:'高一',mustChangePassword:false,identityVerifiedAt:now,notificationOnboardingStatus:'complete',notificationDeviceReady:false}};
    } else if (path === '/dashboard') data={counts:{total:1,today:1,active:1,unread:1,overdue:0},events:[event],lastSyncAt:now};
    else if (path === '/analytics/movements') data=analytics;
    else if (path === '/students') data={items:[student]};
    else if (path === '/messages') data={items:[{publicReference:'TEST-MSG-901',eventId:901,messageType:'NOTICE',createdAt:now,state:'UNREAD',body:'示例消息：学生已到达，请查看后续安排。',senderName:'示例校医',senderRole:'NURSE'}],lastSyncAt:now,hasMore:false};
    else if (path === '/messages/focus' || path === '/movement-requests' || path === '/dorm/incidents') data={items:[]};
    else if (path === '/movements') data={items:[],serverTime:now};
    else if (path === '/movements/capabilities') data={canRelease:true,stationAreas:[],canViewSchoolMetadata:false};
    else if (path === '/dashboard/greeting-ai') {status=503; data={error:'UI fixture: optional generation unavailable'};}
    else { unknown.add(path); status=503; data={error:'UI fixture: route not provided'}; }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  };
  await page.route('**/jxl-api/**', route);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('.jxl-campus-group__toggle').waitFor();
  const widgets = [['dashboard','班主任待办'],['movements','学生放行与返班'],['messages','班级协作消息'],['students','本班学生档案'],['analytics','本班事实统计']];
  const group = page.locator('.jxl-campus-group__toggle');
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  const errors=[];
  const onError=error=>errors.push(error.message);
  page.on('pageerror',onError);
  for (const [id,label] of widgets) {
    await page.getByRole('button',{name:label+'，',exact:false}).click();
    const panel=page.locator(`.jxl-widget-panel[data-widget="${id}"]`);
    await panel.waitFor();
    const headerLayout = await panel.evaluate(node => {
      const back=node.querySelector('.jxl-widget-panel__close').getBoundingClientRect();
      const title=node.querySelector('.jxl-widget-panel__titles').getBoundingClientRect();
      const head=node.querySelector('.jxl-widget-panel__head');
      return {backRight:back.right,titleLeft:title.left,overflow:head.scrollWidth>head.clientWidth+1};
    });
    assert.ok(headerLayout.backRight <= headerLayout.titleLeft, 'return precedes title');
    assert.equal(headerLayout.overflow,false,'page header fits its content region');
    await panel.locator('.jxl-widget-panel__booting').waitFor({state:'detached'});
    await page.waitForTimeout(800);
    assert.equal(await panel.locator('.jxl-widget-panel__error').count(),0,`${label} mounted`);
    assert.ok(await panel.locator('.jxl-widget-panel__stage').innerText(),`${label} renders content`);
    await shot('live-campus-'+id);
    if (id === 'messages') {
      await panel.getByText('示例消息：学生已到达，请查看后续安排。',{exact:false}).scrollIntoViewIfNeeded();
      await shot('live-campus-messages-content');
    }
    await panel.locator('.jxl-widget-panel__close').click();
    await panel.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-composer-input]').filter({visible:true}).count(),1,'return restores conversation');
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.jxl-theme-dial').filter({visible:true}).press('End');
  await page.getByRole('dialog',{name:'设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  for (const [id,label] of widgets) {
    await page.getByRole('button',{name:label+'，',exact:false}).click();
    const panel=page.locator(`.jxl-widget-panel[data-widget="${id}"]`);
    await panel.locator('.jxl-widget-panel__booting').waitFor({state:'detached'});
    await panel.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
    assert.equal(await page.locator('#jxl-campus-widgets-host').getAttribute('data-theme'),'dark','embedded theme follows Host');
    assert.equal(await panel.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(36, 35, 32)','campus dark paper');
    await shot('live-campus-'+id+'-dark');
    await panel.locator('.jxl-widget-panel__close').click();
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.locator('.jxl-theme-dial').filter({visible:true}).press('Home');
  await page.getByRole('dialog',{name:'设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  signedIn=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('.jxl-campus-group').waitFor({state:'detached'});
  await shot('live-workspace-signed-out');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'通用设置',exact:true}).click();
  const account = page.getByRole('region', {name:'用户账号',exact:true});
  await account.waitFor();
  assert.ok(await account.evaluate(node => node.getBoundingClientRect().bottom <= document.querySelector('.jxl-settings-appearance').getBoundingClientRect().top), 'account precedes appearance');
  await shot('live-settings-account');
  await account.getByRole('button',{name:'登录校园账号',exact:true}).click();
  await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'});
  await page.waitForTimeout(800);
  await shot('live-campus-login');
  await page.locator('.jxl-widget-panel__close').click();
  page.off('pageerror',onError);
  await page.unroute('**/jxl-api/**',route);
  assert.deepEqual(errors,[],'all campus surfaces render without runtime exceptions');
  console.log('[paper-surfaces]',JSON.stringify({settings:5,campus:5,campusThemes:2,unknownFixtureRoutes:[...unknown]}));
}
