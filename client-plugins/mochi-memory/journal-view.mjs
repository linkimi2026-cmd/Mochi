export const UI_JOURNAL_LIMITS = {title:120,diary:12000,history:24000};
export function shanghaiDay(at=Date.now()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function journalMethod(entry) {
  const generated=entry?.generator==='model'?'由模型依据活动整理':entry?.generator==='local'?'本机活动摘录':'整理方式未注明';
  return entry?.edited?`${generated} · 已由你修改`:generated;
}
export function schedulingText(snapshot) {
  if(snapshot?.settings?.autoEnabled===false)return '自动整理已关闭。';
  if(snapshot?.settings?.autoEnabled!==true)return '自动整理设置尚未读取。';
  const schedule=snapshot.scheduling;
  if(!schedule||!schedule.started||schedule.closed)return '自动整理状态尚未确认，设置的时间不代表任务已安排。';
  const next=schedule.task?.state==='scheduled'?schedule.task.next_run_at:null;
  const date=next?new Date(next):null;
  const parts=[];
  if(date&&Number.isFinite(date.getTime()))parts.push('下次整理：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date));
  else parts.push('任务尚未报告下次整理时间');
  if(schedule.pendingDates?.length)parts.push(`${schedule.pendingDates.length} 个活动日待补记`);
  if(schedule.failures?.length)parts.push(`${schedule.failures.length} 项整理失败，可查看后重试`);
  return parts.join(' · ')+'。';
}
export function diarySavePayload(entry,draft) {
  return {id:entry.id,expectedRevision:entry.revision,title:draft.title,body:draft.body};
}
export function historyPreviewPayload(preview,title) {
  if(preview.empty||!preview.sourceEntryIds?.length)throw Error('这段时间没有已有日记，不能把空预览保存成总结。');
  return {expectedRevision:preview.historyRevision,title,body:preview.body,sourceEntryIds:[...preview.sourceEntryIds]};
}
