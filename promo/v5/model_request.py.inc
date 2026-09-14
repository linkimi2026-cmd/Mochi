model_script=''
import ast,html as html_lib
original=ast.parse((B/'build_v4.py').read_text())
composer=next(ast.literal_eval(n.value) for n in original.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='composer' for t in n.targets))
composer=composer.replace('id="typed"','id="model-request-typed"').replace('id="caret"','id="model-request-caret"').replace('id="send"','id="model-request-send"')
triangle=Path('/Users/a1379/Documents/测试/triangle-demo.html').read_text()
# Stream an exact excerpt of the delivered source, not invented tool logs.
code=re.search(r'<svg\b.*?</svg>',triangle,re.S).group(0)
request='<section id="model-request" style="position:absolute;inset:0;background:#faf8f2;z-index:95;display:none"><div class="compose-label"><small>从需求，到交互模型</small><h2 style="font-family:MochiDisplay;font-weight:600">把概念，做成可以操作的模型。</h2></div><div id="model-request-composer" style="position:absolute;left:390px;top:520px;width:1140px">'+composer+'</div><div id="model-writing" style="position:absolute;left:410px;top:480px;width:1100px;color:#45584e"><p style="font-size:24px;margin-bottom:18px">生成交互模型</p><pre id="model-code" style="white-space:pre-wrap;overflow:hidden;height:200px;font-size:19px;line-height:1.5;margin:0"></pre><div id="model-output" class="file-pill" style="margin-top:22px">triangle-demo.html</div></div><div class="small-note">需求精简重演 · 生成过程加速呈现 · 已生成源文件节选</div></section>'
html=html.replace('<svg id="thread-layer"',request+'<svg id="thread-layer"')
model_script+='''edit.set('#model-request',{display:'block'},19.5);edit.fromTo('#model-request',{opacity:0,y:45},{opacity:1,y:0,duration:.35},19.5);edit.set('#model-writing,#model-output',{opacity:0},0);edit.fromTo('#model-request h2',{y:35,opacity:0},{y:0,opacity:1,duration:.55},19.6);'''
sentence='做一个三角形交互模型，可切换锐角、直角和钝角。'
for i in range(len(sentence)+1):model_script+=f"edit.set('#model-request-typed',{{textContent:{json.dumps(sentence[:i],ensure_ascii=False)}}},{19.9+i*.045});"
model_script+="edit.fromTo('#cursor',{x:1350,y:735,opacity:0},{x:1484,y:666,opacity:1,duration:.4},20.8);edit.fromTo('#click',{x:1484,y:666,scale:.15,opacity:.8},{scale:1.4,opacity:0,duration:.4},21.2);edit.to('#model-request-send',{scale:.88,duration:.1,yoyo:true,repeat:1},21.2);edit.to('#cursor',{opacity:0,duration:.2},21.4);edit.to('#model-request-composer',{y:-100,opacity:0,duration:.35},21.5);edit.to('#model-request h2',{y:-30,opacity:0,duration:.35},21.5);edit.fromTo('#model-writing',{y:40,opacity:0},{y:0,opacity:1,duration:.4},21.8);"
for i in range(31):model_script+=f"edit.set('#model-code',{{textContent:{json.dumps(code[:int(len(code)*i/30)],ensure_ascii=False)}}},{22+i*.045});"
model_script+="edit.fromTo('#model-output',{y:25,opacity:0},{y:0,opacity:1,duration:.35},23.5);edit.to('#model-request',{y:-50,opacity:0,duration:.45},24.65);edit.set('#model-request',{display:'none'},25.1);"

model_script=re.sub(r'(?<=,)(1[89]\.\d+|2[0-4](?:\.\d+)?)(?=\);)',lambda m:str(float(m.group(0))+mapped(29)-5-19.5),model_script)
script+=model_script

script+=f"edit.set('#outputs',{{visibility:'hidden'}},{mapped(29)-4.65});edit.to('#model-writing,#model-request .compose-label,#model-request .small-note',{{opacity:0,duration:.2}},{mapped(29)-.15});"
