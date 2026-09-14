# View-only reconstruction of verified product messages and ApprovalPanel.
# Exact statuses come from the recorded synthetic demo; no new backend action.
campus_composer=composer.replace('typed','campus-typed').replace('caret','campus-caret').replace('id="send"','id="campus-send"')
approval='''<div class="approval-native"><div class="root"><div class="card"><div class="strip"><span class="dot"></span>等待审批</div><div class="body"><div class="headline">林清老师 将批准并正式放行这条待审批申请：<br><br>学生：陈言蹊（七年级1班）<br>申请来源：林清老师 代学生登记<br>目的地：医务室<br>事由：身体不适<br>预计到达：10 分钟<br>申请编号：mreq_3a714d088c064af8b77a7c3a0fae0d10<br>当前状态：待审批</div></div><div class="actionRow"><button class="reject">拒绝</button><button class="allow">允许一次</button></div></div></div></div>'''
scene('campus-flow',39,19,'<div class="campus-title"><small>校园工作，问 Mochi。</small><h2 id="campus-headline">问一句，状态就清楚。</h2></div><div id="campus-composer">'+campus_composer+'</div><div id="ask-bubble" class="user-bubble">林小禾在不在校，在哪里？</div><div id="ask-answer" class="native-answer"><div class="answer-mo">'+mo.replace('eob-R1-depth','ask-depth')+'</div><p>最新记录是校内流动单（教室去宿舍），状态为「已离班在途」。<br>没有离校记录，按记录仍在校内。</p><p>这条单子<strong>没有到达记录，未确认到达</strong>。<br>系统只记到她离开教室，尚不能确认此刻的具体位置。</p></div><div id="approval-view">'+approval+'</div><div id="approval-result" class="native-answer"><div class="answer-mo">'+mo.replace('eob-R1-depth','approve-depth')+'</div><p>已批准陈言蹊去医务室的申请，状态由「待审批」转为「已放行」。<br>正式放行单已生成，等她到达后登记到达即可。</p></div><div class="small-note">真实演示记录 · 内容节选与界面重演</div>')
enter('.campus-title',39,0,35);enter('#campus-composer',39.1,0,40)
for target,start,sentence,pace in [('campus-typed',39.5,'林小禾在不在校，在哪里？',.1),('campus-typed',48.35,'批准陈言蹊去医务室的放行申请，请展示确认卡。',.06)]:
 for i in range(len(sentence)+1):js.append(f"tl.set('#{target}',{{textContent:{json.dumps(sentence[:i],ensure_ascii=False)}}},{start+i*pace});")
cursor(1484,666,41.1,True)
js.extend(["tl.to('#campus-composer',{y:310,scale:.9,opacity:0,duration:.65},41.8);tl.to('#cursor',{opacity:0,duration:.18},41.9);"])
enter('#ask-bubble',41.8,70,30);enter('#ask-answer',42.7,0,40)
thread(41.8,'M 1484 666 C 1570 620 1600 500 1410 475 S 580 440 465 570',1)
js.append("tl.fromTo('#ask-answer strong',{backgroundColor:'#faf8f2'},{backgroundColor:'#e3edc9',duration:.65,immediateRender:false},45);")
js.extend(["tl.to('#ask-bubble,#ask-answer',{y:-60,opacity:0,duration:.6},47.5);tl.set('#campus-headline',{textContent:'核对申请，然后批准放行。'},48);tl.set('#campus-composer',{y:0,scale:1,opacity:1},48);tl.set('#campus-typed',{textContent:''},48);"])
cursor(1484,666,49.4,True)
js.extend(["tl.to('#campus-composer',{y:-150,opacity:0,duration:.5},50.05);tl.to('#cursor',{opacity:0,duration:.2},50.2);"])
enter('#approval-view',50.25,0,60)
cursor(1439,805,54.05,True)
js.extend(["tl.to('#approval-view .allow',{scale:.94,duration:.1},54.6);tl.to('#approval-view .allow',{scale:1,duration:.15},54.7);tl.to('#approval-view',{y:-50,opacity:0,duration:.5},55.05);tl.to('#cursor',{opacity:0,duration:.2},55.1);"])
enter('#approval-result',55.25,0,45)
thread(57,'M 1710 980 C 1670 1030 1130 1000 955 1000 S 320 940 230 770',1.2)
