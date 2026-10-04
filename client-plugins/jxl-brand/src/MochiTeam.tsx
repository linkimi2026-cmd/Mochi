import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OrbCompanion } from './OrbCompanion';
import { memberAssignment, teamPalette } from './team-palette.mjs';
import { scopeTeamConversationPalette } from './team-conversation-palette.mjs';

type Member = { id: string; name: string; role: 'lead' | 'teammate'; phase: string };
type Task = { ownerName?: string; subject: string; status: string };
type Team = { members: Member[]; tasks: Task[] };
type Props = {
  sessionId: string;
  useSession: (select: (snapshot: any) => any) => any;
  useSessions: (select: (snapshot: any) => any) => any;
  useSessionStatus: (select: (snapshot: Map<string, any>) => any) => any;
  openMember: (current: string, lead: string, target: string) => void;
};

export function MochiTeam({ sessionId, useSession, useSessions, useSessionStatus, openMember }: Props) {
  const lead = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId;
  const team: Team | undefined = useSessions(snapshot => snapshot.projectionsBySession[lead]?.values.agentTeam);
  const statuses = useSessionStatus(snapshot => snapshot);
  const [palette, setPalette] = useState(() => document.documentElement.dataset.mochiPetPalette ?? 'caramel');
  const [error, setError] = useState('');
  const teamRef = useRef<HTMLDivElement>(null);
  const memberPalette = team && team.members.length >= 2 && team.members.some(member => member.id === sessionId)
    ? teamPalette(team.members, sessionId, palette) : undefined;
  useLayoutEffect(() => {
    if (memberPalette) return scopeTeamConversationPalette(teamRef.current, sessionId, memberPalette);
  }, [sessionId, memberPalette]);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(document.documentElement.dataset.mochiPetPalette ?? 'caramel'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mochi-pet-palette'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => setError(''), [sessionId]);
  if (!team || team.members.length < 2) return null;
  return <div ref={teamRef} className="jxl-mochi-team" role="group" aria-label="Mochi 协作成员">
    {team.members.map(member => {
      const busy = member.phase === 'provisioning' || statuses.get(member.id)?.running === true;
      const failed = member.phase === 'failed';
      const assignment = memberAssignment(member, team.tasks);
      const status = failed ? '启动失败' : busy ? '正在处理' : '待命';
      const name = member.role === 'lead' ? '主 Mochi' : member.name;
      return <button key={member.id} type="button" className="jxl-mochi-team__member"
        data-mochi-member-id={member.id} data-mochi-pet-palette={teamPalette(team.members, member.id, palette)}
        aria-label={`${name}，${assignment}，${status}`} aria-current={member.id === sessionId ? 'true' : undefined}
        title={`${name} · ${assignment} · ${status}`} disabled={failed || member.phase === 'provisioning'}
        onClick={() => { try { openMember(sessionId, lead, member.id); setError(''); } catch { setError('暂时无法打开成员对话，请稍后再试。'); } }}>
        <OrbCompanion size={28} state={failed ? 'error' : busy ? 'typing' : 'idle'} />
        <span><strong>{name}</strong><small>{assignment}</small></span>
      </button>;
    })}
    {error && <span className="jxl-mochi-team__error" role="alert">{error}</span>}
  </div>;
}

/** Add presentation to the official team projection; scheduling stays entirely upstream. */
export function registerMochiTeam(ctx: any) {
  if (!ctx.uiSession.sessionStatus) return;
  return ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'mochi-team-members', order: -21,
    inject: () => ({ openMember(current: string, lead: string, target: string) {
      if (target === current) return;
      if ((ctx.sessions.retainInfo(current).getSnapshot().retainedBy.mainView ?? 0) === 0) return;
      ctx.uiWorkspace.openSession(target === lead ? lead : { parentSessionId: lead, childSessionId: target, mode: 'continuable' });
    } }),
  }, MochiTeam));
}
