preset_start=mapped(88);preset_end=mapped(91)
entries=[('成绩分析','用教师明确的成绩口径分析 XLSX 或 CSV，并在成绩工具可用时生成可复核的内部审计工作簿。','grade-analysis'),('班级与教室','查看当前班级与校园事项，按权限和人工确认协调消息、任务与设备协作；未连通时明确不可用。','classroom-coordination'),('创造模式','用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。','cordis')]
panels=''.join(f'<div class="preset-pop pop-{i}"><div class="preset-native"><div class="card"><div class="cardMain"><div class="preset-name">{name}<span>内置</span></div><p>{desc}</p><code>{ident}</code></div><div class="preset-actions">▤　▢</div></div></div></div>' for i,(name,desc,ident) in enumerate(entries))
body='<section id="preset-showcase" style="position:absolute;inset:0;display:none;background:#f3f5ec;z-index:96"><div class="preset-title"><small>为不同的工作，准备不同的能力</small><h2>我们还预置了丰富的功能，<br><span>比如 Agent 预设。</span></h2></div>'+panels+'<div class="small-note">成绩分析 · 班级与教室 · 创造模式　｜　产品原生预设内容</div></section>'
html=html.replace('<svg id="thread-layer"',body+'<svg id="thread-layer"')
preset_css=(B.parent/'mochi-harness-src.nosync/mochi-harness/packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css').read_text()
# Reuse card geometry; only editorial placement/movement is custom.
card_rules='\n'.join(re.findall(r'\.(?:card|cardMain)\s*\{[^}]+\}',preset_css))
card_rules=re.sub(r'\.(card|cardMain)',r'.preset-native .\1',card_rules)
html=html.replace('</style>',card_rules+''' .preset-title{position:absolute;left:160px;top:150px}.preset-title h2{margin-top:20px;font-size:54px}.preset-title h2>span{font-family:MochiDisplay;font-weight:600}.preset-pop{position:absolute;left:150px;top:450px;width:500px;background:#fff;border-radius:25px;box-shadow:0 18px 55px #29493410;overflow:hidden}.pop-1{left:710px;top:505px}.pop-2{left:1270px;top:460px}.preset-native{--dsw-alias-border-l4:#dbe0d6;color:#35493d;font-family:Mochi}.preset-native .cardMain{padding:32px}.preset-name{font-size:30px;font-weight:700;margin-bottom:22px}.preset-name span{font-weight:400;font-size:18px;margin-left:15px;border:1px solid #dbe0d6;border-radius:15px;padding:2px 8px}.preset-native p{font-size:24px;line-height:1.75;margin-bottom:24px}.preset-native code{font-size:20px;color:#607362}.preset-actions{border-top:1px solid #e5e8df;padding:17px 28px;text-align:right;font-size:22px;color:#647560}
</style>''')
script+=f"edit.set('#preset-showcase',{{display:'block'}},{preset_start});edit.fromTo('#preset-showcase',{{opacity:0}},{{opacity:1,duration:.3}},{preset_start});edit.fromTo('.preset-title',{{y:40,opacity:0}},{{y:0,opacity:1,duration:.6}},{preset_start+.1});"
for i in range(3):
 script+=f"edit.fromTo('.pop-{i}',{{y:{160 if i!=1 else -130},scale:.85,opacity:0}},{{y:0,scale:1,opacity:1,duration:.7,ease:'back.out(1.15)'}},{preset_start+.3+i*.18});edit.to('.pop-{i}',{{y:{-50 if i!=1 else 45},duration:3.5,ease:'sine.inOut'}},{preset_start+1.2});"
script+=f"edit.to('#preset-showcase',{{y:-55,opacity:0,duration:.4}},{preset_end-.15});edit.set('#preset-showcase',{{display:'none'}},{preset_end+.25});"
# Original Mo's actual SVG ellipses blink; use ry rather than raster substitution.
script+="edit.to('#intro .expressive-orb__eye',{attr:{ry:1},duration:.09,yoyo:true,repeat:1},1.15);edit.to('#intro .orb-companion__orb',{y:-5,duration:.7,yoyo:true,repeat:1,ease:'sine.inOut'},.45);"
script+=f"edit.to('#mo-final .expressive-orb__eye',{{attr:{{ry:1}},duration:.1,yoyo:true,repeat:1}},{mapped(97)+1.4});edit.to('#mo-final .orb-companion__orb',{{rotation:3,transformOrigin:'50% 80%',duration:.45,yoyo:true,repeat:1,ease:'sine.inOut'}},{mapped(97)+1.8});"

script+=f"edit.set('#presets',{{visibility:'hidden'}},{preset_start+.3});"
