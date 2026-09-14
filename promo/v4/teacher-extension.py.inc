# Insert a verified ASK/response story between approval and FIND, extending to 102 s.
late=[m['id'] for m in manifest if m['start']>=58]
js.append('const lateScenes=new Set('+json.dumps(late)+');for(const tween of [...tl.getChildren(false,true,true)]){const start=tween.startTime();if(start<58)continue;const targets=tween.targets?.()||[];const scenes=targets.map(n=>n?.closest?.(".scene")?.id).filter(Boolean);if(scenes.some(id=>lateScenes.has(id))||(!scenes.length&&start>=59))tween.startTime(start+12);}')
for m in manifest:
 if m['start']>=58:m['start']+=12
for m in cursor_moves:
 if m['t']>=58:m['t']+=12
# Media start times in the original late sections must track the same insertion.
for i,section in enumerate(sections):
 if re.match(r'<section id="([^"]+)"',section).group(1) in late:
  sections[i]=re.sub(r'data-start="([\d.]+)"',lambda m:f'data-start="{float(m.group(1))+12:g}"',section)
response_composer=composer.replace('typed','teacher-typed').replace('caret','teacher-caret').replace('id="send"','id="teacher-send"')
scene('teacher-talk',58,12,'<div class="teacher-heading"><small>沟通老师 · ASK / 回应</small><h2>让老师的安排，<br>得到清楚的回音。</h2></div><div id="teacher-incoming" class="native-answer"><div class="answer-mo">'+mo.replace('eob-R1-depth','teacher-in-depth')+'</div><p>林清老师询问：<br><strong>“明天上午能不能使用多媒体教室？”</strong></p></div><div id="teacher-composer">'+response_composer+'</div><div id="teacher-response" class="native-answer"><div class="answer-mo">'+mo.replace('eob-R1-depth','teacher-out-depth')+'</div><p>已回复林清老师。</p><p><strong>可以，明天上午多媒体教室可以使用。</strong><br>状态：已完成 · 投递结果：已确认投递。</p></div><div class="small-note">真实 ASK 与回应记录节选 · 经主人确认后发送</div>')
enter('#teacher-incoming',58.35,0,35);enter('#teacher-composer',60.1,0,50)
js.append("tl.to('#teacher-incoming',{y:-55,opacity:0,duration:.5},60);tl.fromTo('#teacher-talk .glyph',{yPercent:110,opacity:0},{yPercent:0,opacity:1,stagger:{amount:.3},duration:.7,immediateRender:false},58.1);")
sentence='回复林清老师：可以，明天上午多媒体教室可以使用。'
for i in range(len(sentence)+1):js.append(f"tl.set('#teacher-typed',{{textContent:{json.dumps(sentence[:i],ensure_ascii=False)}}},{60.7+i*.08});")
cursor(1484,666,63.1,True)
js.append("tl.to('#teacher-composer',{y:-100,opacity:0,duration:.6},64);tl.to('#teacher-talk .glyph',{yPercent:-95,opacity:0,stagger:{amount:.12},duration:.4},69.45);tl.to('#teacher-talk small',{opacity:0,duration:.3},69.6);")
enter('#teacher-response',64.8,0,45)
js.append("tl.to('#campus-flow .small-note',{opacity:0,duration:.2},57.75);tl.fromTo('#teacher-talk .small-note',{opacity:0},{opacity:1,duration:.3,immediateRender:false},58.5);")
# Hover navigation links the actual artifact and role nodes; no independent decorative route.
cursor(680,834,17.0,True)
cursor(1365,320,21.7)
cursor(862,138,70.05)
cursor(1530,138,71.05)
cursor(1530,138,74.05)
cursor(862,138,75.05)
cursor(960,550,97.15)
# The cursor and its dashed trace use exactly the same SVG geometry and progress.
js.insert(0,(O/'cursor-flight.js').read_text())
js.append('addCursorFlights('+json.dumps(cursor_moves)+');')
js.append('tl.to({v:0},{v:1,duration:102},0);')
starts={m['id']:m['start'] for m in manifest}
sections.sort(key=lambda s:starts[re.match(r'<section id="([^"]+)"',s).group(1)])
manifest.sort(key=lambda m:m['start'])
css+=(O/'teacher-extension.css').read_text()
