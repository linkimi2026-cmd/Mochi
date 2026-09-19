import fs from 'node:fs/promises';
import path from 'node:path';
import {Presentation, PresentationFile} from '@oai/artifact-tool';
const root=path.resolve(import.meta.dirname,'..');
const assets=path.join(root,'assets');
const p=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#F8F3E7',ink:'#243F36',green:'#567A5E',muted:'#72806F',gold:'#A56C2E'};
const font='Arial';
const chinese='Songti SC';
function text(s,str,x,y,w,h,size=36,color=C.ink,name='text',bold=false){
 const a=s.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 const expressive=['bridge','center','final-brand','layer2'].includes(name);
 a.text=str;a.text.style={typeface:expressive?chinese:'Heiti TC',fontSize:size,bold,color,autoFit:'none',alignment:['title','closing-title'].includes(name)?'left':'center'};return a;
}
async function img(s,file,x,y,w,h,name){return s.images.add({blob:new Uint8Array(await fs.readFile(path.join(assets,file))),contentType:'image/png',alt:name,fit:'contain',position:{left:x,top:y,width:w,height:h}});}
function slide(){const s=p.slides.add();s.background.fill=C.bg;return s;}
function note(s,txt,source=''){s.speakerNotes.textFrame.setText(txt+'\n\n素材与事实来源：'+source);}
const notes=[
 "【00:00–01:20，80秒】播放完整宣传片。视频结束后进入下一页。",
 "【01:20–01:45，25秒】项目最开始是一个校园网站。学生去医务室或宿舍后，老师很难及时知道进展，所以我们先做嘉行联，连接放行、到达和返班。后来发现，备课、资料和沟通也很分散。我们要连接的是整段工作。这促成了 Mochi，嘉行联则继续承担校园业务后端。",
 "【01:45–02:15，30秒】我们用 Electron 封装桌面端，React 和 TypeScript 构建界面，DeepSeek Harness 驱动 Agent，再通过校园 API 连接嘉行联。开源内核不是我们的原创。我们做的是校园适配，让课件、资料、校园状态和不同端的 Agent 接起来。做安装包，也是为了让普通老师不用先打开终端，就能开始使用。",
 "【02:15–02:50，35秒】接下来是教师端和教室端互联的未来规划。学生可以在教室端查自己的错题，问 AI“这题怎么做”，也可以找老师预约答疑。请求送到教师端，老师确认时间后，再回到学生这里。课前，它还可以按已确认的课表、老师偏好和授权计划，提前打开常用 APP、备好课件，不打断正在进行的课堂。我们希望它像一个熟悉习惯的管家。这些事很细微，却让人舒服；这也是我们说的默契。",
 "【02:50–03:22，32秒】这个项目改变了我们对人机结合的理解。AI 做得快，不代表它知道结果是不是我们真正想要的。从校园网站到 Mochi，从终端网页到安装包，方向都来自真实使用后，人的重新判断。AI 让试错更便宜，我们可以做出来、否定它、再实现。它不断逼近我们的想法，我们也在过程中重新认识自己的想法。",
 "【03:22–03:57，35秒；03:57–04:00停留】做到后来，我们用默契形容想探索的人机关系。它不是记住一切或交出所有权限，而是逐渐理解我们在做什么，结果接下来要去哪里，也知道何时必须让人决定。Agent 可以协作，但分享资料和关键判断的权力仍属于人。我们希望在反馈中形成有边界的默契，让 AI 适应人的工作。AI 放大人的能力，人决定能力的方向。"
];
let s=slide();await img(s,'视频封面.png',0,0,1280,720,'video-poster');note(s,notes[0],'promo/output/Mochi_80秒_2K120帧_V5.mp4');
s=slide();text(s,'从嘉行联，到 Mochi',70,50,1140,80,54,C.ink,'title',true);
text(s,'灵感，来自老师看不见的那段进展。',120,147,1040,60,36,C.gold,'bridge');
text(s,'学生离开教室后，放行、到达、返班的信息难以及时同步。',90,216,1100,45,27,C.ink,'pain');
await img(s,'嘉行联-真实历史网站.png',60,270,550,344,'嘉行联真实历史网站');
await img(s,'Mochi-真实界面.png',670,270,550,344,'Mochi真实界面');
text(s,'嘉行联 · 先连接学生流转',60,616,550,42,26,C.muted,'caption');text(s,'Mochi · 再连接教师工作',670,616,550,42,26,C.muted,'caption');
text(s,'备课、资料、沟通仍然分散 → 让整段工作自然连接',120,666,1040,36,25,C.green,'pain-next');
note(s,notes[1],'联动计划/qa-evidence/20260820-home-painterly-1440x900.png（2026-08-20历史截图，并非首版证据）；promo/v5/assets/home.mp4；docs/PROJECT-HISTORY.md');
s=slide();text(s,'我们没有重新发明 AI',70,45,1140,62,44,C.muted,'title');text(s,'我们重新设计了它怎样进入校园',70,109,1140,76,52,C.ink,'title',true);
text(s,'桌面与界面',75,237,310,44,27,C.muted,'stack-label');
text(s,'Mochi',75,292,310,72,61,C.ink,'layer2',true);
text(s,'Electron',75,378,310,42,29,C.green,'stack-tech');
text(s,'React · TypeScript',60,426,340,42,26,C.green,'stack-tech');
text(s,'→',391,319,58,60,40,C.gold,'arrow');
text(s,'Agent 运行内核',465,237,350,44,27,C.muted,'stack-label');
text(s,'DeepSeek Harness',450,311,380,60,35,C.ink,'stack-core',true);
text(s,'工具调用 · 任务执行',450,403,380,44,27,C.green,'stack-tech');
text(s,'→',825,319,58,60,40,C.gold,'arrow');
text(s,'校园业务后端',895,237,310,44,27,C.muted,'stack-label');
text(s,'嘉行联',895,300,310,72,50,C.ink,'stack-backend',true);
text(s,'校园 API 对接',895,378,310,42,29,C.green,'stack-tech');
text(s,'账号权限 · 状态与消息',865,426,370,42,26,C.green,'stack-tech');
text(s,'我们实现的校园适配',95,539,1090,44,29,C.gold,'contribution',true);
['教师工作','校园状态','A2A 协作','桌面安装'].forEach((v,i)=>text(s,v,85+i*306,608,265,44,28,C.green,'capability'));
note(s,notes[2],'vendor/alpha-family/deepseek-ai-dsh-*.tgz；docs/agent-integration-handbook.md；docs/PROJECT-HISTORY.md；apps/desktop/；plugins/mochi-campus/；plugins/mochi-a2a/');
s=slide();text(s,'教师端与教室端互联',70,50,1140,80,54,C.ink,'title',true);
text(s,'未来规划 · 学习答疑与课前管家',70,142,1140,50,29,C.gold,'roadmap');
text(s,'教室端 · 学生',90,231,440,57,39,C.ink,'classroom',true);
text(s,'查询自己的错题',90,313,440,46,30,C.green,'student-review');
text(s,'问 AI：“这题怎么做？”',75,375,470,46,30,C.green,'student-ai');
text(s,'找老师预约答疑时间',90,437,440,46,30,C.green,'student-booking');
text(s,'预约请求 →',535,325,205,44,26,C.gold,'request');
text(s,'← 确认时间',535,392,205,44,26,C.gold,'response');
text(s,'教师端 · 老师',750,231,440,57,39,C.ink,'teacher',true);
text(s,'接收请求，安排答疑',750,313,440,46,30,C.green,'teacher-booking');
text(s,'确认课表与常用 APP 偏好',735,375,470,46,29,C.green,'teacher-preference');
text(s,'教室端按授权计划提前准备',725,437,490,46,29,C.green,'classroom-preflight');
text(s,'课前打开常用 APP、备好课件，不打断课堂',100,537,1080,47,31,C.ink,'butler');
text(s,'像熟悉习惯的管家，细微，却让人舒服。',90,624,1100,55,37,C.gold,'bridge');
note(s,notes[3],'未来规划，非已完成功能声明。来源：用户本次补充；Mochi-总体方案.md §2–3；docs/agent-integration-handbook.md 教师端与独立教室端；docs/reference/prompt-archives/Mochi_系统提示词_V1.3_完整阅读版.md 教师偏好与课前准备。预约请求与确认时间往返为本页建议交互流程，尚未验证落地；偏好不等于自动执行授权。');
s=slide();text(s,'AI 很快，但方向仍然需要人',70,50,1140,80,53,C.ink,'title',true);
const nodes=[['人的想法',190,210],['AI 实现',830,210],['现实结果',870,462],['人的重新判断',130,462]];
for(const [v,x,y] of nodes)text(s,v,x,y,350,65,40,v.startsWith('人')?C.gold:C.ink,'cycle');
text(s,'→',585,218,90,55,42,C.green,'arrow');text(s,'↓',980,338,80,60,42,C.green,'arrow');
text(s,'←',583,470,90,55,42,C.green,'arrow');text(s,'↑',256,337,80,60,42,C.green,'arrow');
text(s,'AI 再实现',82,348,170,42,25,C.muted,'cycle-repeat');
text(s,'不断逼近',498,330,330,78,56,C.green,'center',true);
note(s,notes[4],'项目方提供的人机协作经历与演讲观点；docs/PROJECT-HISTORY.md。该循环表达创作方法，不表示产品自动替人决定方向。');
s=slide();text(s,'我们想探索的',78,52,700,55,32,C.muted,'closing-title');
text(s,'默契',66,126,465,180,136,C.ink,'center',true);
await img(s,'Mo-品牌原画.png',153,323,230,246,'Mo本尊');
text(s,'AI 理解工作',600,183,540,65,48,C.ink,'closing-detail',true);
text(s,'人决定边界',600,292,540,65,48,C.gold,'closing-detail',true);
text(s,'让 AI 适应人的工作',600,405,540,64,34,C.green,'closing-detail');
text(s,'AI 放大人的能力，人决定能力的方向。',76,602,1128,64,34,C.ink,'closing-message');
text(s,'Mochi',390,230,500,115,96,C.ink,'final-brand',true);
text(s,'让校园里的工作，自然连接。',235,391,810,82,43,C.green,'final-tagline');
note(s,notes[5],'Mo 原型来自 client-plugins/jxl-brand/src/OrbCompanion.tsx 与 ExpressiveOrb.tsx；本页使用 promo/v5/qa-final/frame-11-at-78s.png 的品牌区域。其余为项目方愿景与演讲观点。');
await fs.writeFile(path.join(root,'讲稿与播放说明.md'),'# Mochi 四分钟答辩\n\n播放顺序：80 秒内嵌视频 + 五页讲述 157 秒 + 结尾停留 3 秒。讲稿时间为排练目标，需以实际语速复核。\n\n'+notes.map((n,i)=>'## '+(i===0?'开场视频':'重点页 '+i)+'\n\n'+n).join('\n\n')+'\n');
await fs.appendFile(path.join(root,'讲稿与播放说明.md'),'\n## WPS 现场播放'+await fs.readFile(path.join(root,'scripts/playback-instructions.md'),'utf8'));
await (await PresentationFile.exportPptx(p)).save(path.join(root,'.build','base.pptx'));
for(let i=0;i<p.slides.items.length;i++) {const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1.5});await fs.writeFile(path.join(root,'.build',`slide-${i+1}.png`),new Uint8Array(await blob.arrayBuffer()));}
console.log('Base deck exported: 6 slides');
