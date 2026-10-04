/** Rules act on actual recognizer output; they never invent homework content. */
export function classifyTranscript(raw, recording = false) {
  const text = raw.trim();
  const command = text.replace(/[，。！？、\s]/g, '');
  if (/^(?:请)?(?:把猫叫出来|猫叫出来|叫猫出来|猫出来|Mochi出来|mochi出来|茉叽出来)$/.test(command)) return { kind: 'wake', text };
  if (/^(?:结束作业记录|作业记录结束|停止记录作业|作业说完了)$/.test(command)) return { kind: 'finish', text };
  // A word anywhere triggers; explicit negation is the only suppression.
  const homework = text.split(/[，。！？；]/).some(part => part.includes('作业') && !/(?:没有|没|不(?:要|用|布置)|无需|取消|不是).{0,6}作业|作业.{0,4}(?:不用|不需要|取消)/.test(part));
  if (!recording && homework) return { kind: 'begin', text };
  return { kind: recording ? 'append' : 'ignore', text };
}
