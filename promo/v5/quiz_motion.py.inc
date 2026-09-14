quiz_end=mapped(35);quiz_start=quiz_end-6
source_quiz=Path('/Users/a1379/Documents/测试/三角形练习.html').read_text()
quiz_body=re.search(r'<main>(.*?)</main>',source_quiz,re.S).group(1)
quiz_css=re.search(r'<style>(.*?)</style>',source_quiz,re.S).group(1)
scoped=[]
for selector,rules in re.findall(r'([^{}]+)\{([^{}]*)\}',quiz_css):
 selector=re.sub(r'/\*.*?\*/','',selector,flags=re.S).strip()
 if selector in [':root','body','main','*']:continue
 scoped.append(','.join('#quiz-page '+x.strip() for x in selector.split(','))+'{'+rules+'}')
quiz_composer=composer.replace('model-request-typed','quiz-typed').replace('model-request-caret','quiz-caret').replace('model-request-send','quiz-send')
body='<section id="quiz-story" style="position:absolute;inset:0;display:none;background:#f6f3ed;z-index:95"><div id="quiz-heading" style="position:absolute;left:170px;top:170px"><small>从动手观察，到主动判断</small><h2 style="margin-top:22px;font-family:MochiDisplay;font-weight:600">接着，把理解变成练习。</h2></div><div id="quiz-composer" style="position:absolute;left:390px;top:520px;width:1140px">'+quiz_composer+'</div><div id="quiz-page">'+quiz_body+'</div><div class="small-note">继续输入需求 · 生成加速节选 · Mochi 实际生成的随堂练习</div></section>'
html=html.replace('<svg id="thread-layer"',body+'<svg id="thread-layer"')
html=html.replace('</style>',''.join(scoped)+'''#quiz-page{position:absolute;left:970px;top:220px;width:520px;transform:scale(1.35);transform-origin:0 0;font-family:Mochi;--ink:#2c2c2c;--ink-2:#586058;--accent:#3f5b99;--ok:#2f7a4f;--no:#b4552d;--line:#dcdcd8;background:#fbfbf9;padding:30px;border-radius:22px;box-shadow:0 20px 55px #41533512}#quiz-page button{transition:none!important}#quiz-heading h2{max-width:700px}#quiz-story .back{pointer-events:none}
</style>''')
script+=f"edit.set('#quiz-story',{{display:'block'}},{quiz_start});edit.set('#model',{{visibility:'hidden'}},{quiz_start+.35});edit.set('#quiz-page',{{opacity:0}},0);edit.fromTo('#quiz-story',{{opacity:0,y:45}},{{opacity:1,y:0,duration:.35}},{quiz_start});edit.fromTo('#quiz-heading',{{opacity:0,y:35}},{{opacity:1,y:0,duration:.45}},{quiz_start+.1});"
sentence='根据这个模型，生成 3 道判断题，并给出解析。'
for i in range(len(sentence)+1):script+=f"edit.set('#quiz-typed',{{textContent:{json.dumps(sentence[:i],ensure_ascii=False)}}},{quiz_start+.4+i*.04});"
script+=f"edit.fromTo('#cursor',{{x:1300,y:755,opacity:0}},{{x:1484,y:666,opacity:1,duration:.35}},{quiz_start+1.2});edit.fromTo('#click',{{x:1484,y:666,scale:.15,opacity:.8}},{{scale:1.4,opacity:0,duration:.4}},{quiz_start+1.55});edit.to('#quiz-composer',{{y:-100,opacity:0,duration:.3}},{quiz_start+1.7});edit.to('#cursor',{{opacity:0,duration:.15}},{quiz_start+1.85});edit.to('#quiz-heading',{{y:160,duration:.5}},{quiz_start+1.8});edit.fromTo('#quiz-page',{{x:130,opacity:0}},{{x:0,opacity:1,duration:.6}},{quiz_start+2});edit.fromTo('#quiz-page .q',{{y:25,opacity:0}},{{y:0,opacity:1,stagger:.2,duration:.4}},{quiz_start+2.2});"
script+=f"edit.fromTo('#cursor',{{x:1400,y:700,opacity:0}},{{x:1056,y:501,opacity:1,duration:.4}},{quiz_start+3.2});edit.fromTo('#click',{{x:1056,y:501,scale:.15,opacity:.8}},{{scale:1.4,opacity:0,duration:.4}},{quiz_start+3.6});edit.set('#quiz-page .q:first-of-type button:first-child',{{backgroundColor:'#2f7a4f',color:'#fff'}},{quiz_start+3.6});edit.set('#quiz-page .q:first-of-type .feedback',{{display:'flex',color:'#2f7a4f'}},{quiz_start+3.6});edit.set('#quiz-page .q:first-of-type .feedback .text',{{textContent:'答对了。100° 比 90° 大，是钝角；按最大的角分类，它就是钝角三角形。'}},{quiz_start+3.6});edit.to('#cursor',{{opacity:0,duration:.2}},{quiz_start+4});edit.to('#quiz-story',{{x:-80,opacity:0,duration:.35}},{quiz_end-.05});edit.set('#quiz-story',{{display:'none'}},{quiz_end+.3});"
