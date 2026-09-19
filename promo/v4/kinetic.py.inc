# Editorial typography moves with the shot; product labels are never split.
kinetic_boot='''const editorial = document.querySelectorAll('.scene h2:not(#campus-headline),.intro-copy h1>span,.caption b,.end-title>.wordmark,.end-title>.arrival');
editorial.forEach(el=>{if(el.closest('#model-original'))return;const walk=node=>{for(const child of [...node.childNodes]){if(child.nodeType===3){const fragment=document.createDocumentFragment();for(const char of Array.from(child.textContent)){const wrap=document.createElement('span');wrap.className='glyph-mask';const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=char;wrap.append(glyph);fragment.append(wrap);}child.replaceWith(fragment);}else if(child.nodeName!=='BR')walk(child);}};walk(el);});'''
js.insert(0,kinetic_boot)
js.append("tl.set('#intro .intro-mark',{scale:1.15},0);")
for shot in manifest:
 ident=shot['id'];t=shot['start'];end=t+shot['duration']
 title_start=t+.1
 if ident=='outputs':title_start=21.25
 if ident=='end':title_start=85.55
 if ident!='campus-flow':js.append(f"tl.fromTo('#{ident} .glyph',{{yPercent:115,rotation:2,opacity:0}},{{yPercent:0,rotation:0,opacity:1,stagger:{{amount:.28}},duration:.7,ease:'power3.out',immediateRender:false}},{title_start});")
 if ident!='end':
  js.append(f"tl.to('#{ident} small',{{opacity:0,duration:.25}},{end-.35});") if ident in ['compose','outputs','model','campus-flow','findpeer','findreturn','received','classroom','connected'] else None
  if ident!='campus-flow':js.append(f"tl.to('#{ident} .glyph',{{yPercent:-95,opacity:0,stagger:{{amount:.12}},duration:.4,ease:'power2.in'}},{end-.55});")
  if ident in ['home','setup','campus','findpeer','findreturn','received','presets']:js.append(f"tl.to('#{ident} .product-window',{{x:-65,opacity:.65,duration:.6}},{end-.15});")
  if shot['title']:js.append(f"tl.to('#{ident} .caption span',{{y:-15,opacity:0,duration:.35}},{end-.1});")
 if shot['title']:js.append(f"tl.fromTo('#{ident} .caption span',{{y:20,opacity:0}},{{y:0,opacity:1,duration:.65,immediateRender:false}},{t+.2});")
js.append("tl.to('#campus-headline',{y:-20,opacity:0,duration:.32},47.5);tl.fromTo('#campus-headline',{y:22,opacity:0},{y:0,opacity:1,duration:.6,immediateRender:false},48);")
# Shared directional momentum through each major visual hand-off.
js.append("tl.to('#intro .intro-mark',{x:-100,scale:.82,opacity:0,duration:.65},2.85);tl.to('#outputs #conveyor',{x:-80,scale:.97,duration:.7},28.8);tl.to('#model-card',{x:-80,opacity:.7,duration:.65},34.85);tl.to('#class-slide2',{x:-80,opacity:.65,duration:.6},75.85);tl.to('.end-art',{x:-70,opacity:0,stagger:.08,duration:.65},84.8);")
