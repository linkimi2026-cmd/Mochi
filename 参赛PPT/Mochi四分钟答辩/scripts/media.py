from pathlib import Path
from lxml import etree as E
import zipfile, hashlib, json

project_root=Path(__file__).resolve().parent.parent
build_root=project_root/'.build'
repo_root=project_root.parents[1]
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PK='http://schemas.openxmlformats.org/package/2006/relationships'
ns={'p':P,'a':A,'r':R}
def xml(t):return E.fromstring(t.encode())
def dump(t):return E.tostring(t,encoding='utf-8',xml_declaration=True)
with zipfile.ZipFile(build_root/'base.pptx') as z: files={n:z.read(n) for n in z.namelist()}
video=(repo_root/'promo/output/Mochi_80秒_2K120帧_V5.mp4').read_bytes()
files['ppt/media/mochi-80s.mp4']=video
ct=E.fromstring(files['[Content_Types].xml'])
E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Default',Extension='mp4',ContentType='video/mp4')
files['[Content_Types].xml']=dump(ct)
rel=E.fromstring(files['ppt/slides/_rels/slide1.xml.rels'])
for id,typ in [('rIdVideo',R+'/video'),('rIdMedia','http://schemas.microsoft.com/office/2007/relationships/media')]:
 E.SubElement(rel,'{'+PK+'}Relationship',Id=id,Type=typ,Target='../media/mochi-80s.mp4')
files['ppt/slides/_rels/slide1.xml.rels']=dump(rel)

def timing(slide,events,video_id=None):
 t=E.SubElement(slide,'{'+P+'}timing');lst=E.SubElement(t,'{'+P+'}tnLst');par=E.SubElement(lst,'{'+P+'}par')
 node=E.SubElement(par,'{'+P+'}cTn',id='1',dur='indefinite',restart='never',nodeType='tmRoot');roots=E.SubElement(node,'{'+P+'}childTnLst')
 seq=E.SubElement(roots,'{'+P+'}seq',concurrent='1',nextAc='seek')
 main=E.SubElement(seq,'{'+P+'}cTn',id='2',dur='indefinite',nodeType='mainSeq');ml=E.SubElement(main,'{'+P+'}childTnLst')
 group=E.SubElement(ml,'{'+P+'}par');gn=E.SubElement(group,'{'+P+'}cTn',id='3',fill='hold')
 start=E.SubElement(gn,'{'+P+'}stCondLst');E.SubElement(start,'{'+P+'}cond',delay='0')
 inter=E.SubElement(gn,'{'+P+'}childTnLst');ip=E.SubElement(inter,'{'+P+'}par');inn=E.SubElement(ip,'{'+P+'}cTn',id='4',fill='hold')
 isc=E.SubElement(inn,'{'+P+'}stCondLst');E.SubElement(isc,'{'+P+'}cond',delay='0')
 child=E.SubElement(inn,'{'+P+'}childTnLst')
 for name,event in [('prevCondLst','onPrev'),('nextCondLst','onNext')]:
  co=E.SubElement(seq,'{'+P+'}'+name);cond=E.SubElement(co,'{'+P+'}cond',evt=event,delay='0');tg=E.SubElement(cond,'{'+P+'}tgtEl');E.SubElement(tg,'{'+P+'}sldTgt')
 count=5
 for spid,delay,mode in events:
  vis='visible' if mode=='in' else 'hidden'
  frag=f'''<p:par xmlns:p="{P}"><p:cTn id="{count}" fill="hold" presetID="10" presetClass="{'entr' if mode=='in' else 'exit'}" presetSubtype="0" nodeType="withEffect"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="{count+2}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{'0' if mode=='in' else '650'}"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{vis}"/></p:to></p:set><p:animEffect transition="{mode}" filter="fade"><p:cBhvr><p:cTn id="{count+1}" dur="650" fill="hold"/><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>'''
  el=xml(frag);el.find('p:cTn',ns).set('grpId','0');child.append(el);count+=3
 bld=E.SubElement(t,'{'+P+'}bldLst')
 for spid in sorted(set(x[0] for x in events)):
  E.SubElement(bld,'{'+P+'}bldP',spid=spid,grpId='0')
 if video_id:
  child.append(xml(f'''<p:video xmlns:p="{P}"><p:cMediaNode vol="80000"><p:cTn id="{count}" fill="hold" display="0"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{video_id}"/></p:tgtEl></p:cMediaNode></p:video>'''))
for i in range(1,7):
 key=f'ppt/slides/slide{i}.xml';s=E.fromstring(files[key])
 tr=E.SubElement(s,'{'+P+'}transition',spd='med',advClick='1')
 E.SubElement(tr,'{'+P+'}fade')
 if i==1:
  pic=s.find('.//p:pic',ns);nv=pic.find('p:nvPicPr',ns);pr=nv.find('p:cNvPr',ns)
  E.SubElement(pr,'{'+A+'}hlinkClick',{'action':'ppaction://media'})
  nvpr=nv.find('p:nvPr',ns)
  E.SubElement(nvpr,'{'+A+'}videoFile',{'{'+R+'}link':'rIdVideo'})
  extlst=E.SubElement(nvpr,'{'+P+'}extLst');ext=E.SubElement(extlst,'{'+P+'}ext',uri='{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}')
  E.SubElement(ext,'{http://schemas.microsoft.com/office/powerpoint/2010/main}media',{'{'+R+'}embed':'rIdMedia'})
  timing(s,[],pr.get('id'))
 else:
  shapes=s.findall('.//p:spTree/p:sp',ns)+s.findall('.//p:spTree/p:pic',ns)
  events=[]
  for j,sh in enumerate(shapes):
   pr=sh.find('.//p:cNvPr',ns);name=pr.get('name','');id=pr.get('id')
   if i==6:
    if name.startswith('final-'):events.append((id,35000,'in'))
    else:events.append((id,min(j*300,1400),'in'));events.append((id,34350,'out'))
   else:events.append((id,min(j*220,2000),'in'))
  timing(s,events)
 files[key]=dump(s)
with zipfile.ZipFile(build_root/'candidate.pptx','w',compression=zipfile.ZIP_DEFLATED) as z:
 for n,b in files.items():z.writestr(n,b)
print(json.dumps({'slides':6,'embeddedVideoBytes':len(video),'embeddedVideoSHA256':hashlib.sha256(video).hexdigest()}))
