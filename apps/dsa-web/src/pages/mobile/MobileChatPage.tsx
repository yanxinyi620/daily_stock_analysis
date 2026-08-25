import { Menu, Plus, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAgentChatStore } from '../../stores/agentChatStore';
import { useUiLanguage } from '../../contexts/UiLanguageContext';

const MobileChatPage = () => {
  const chat = useAgentChatStore();
  const { t } = useUiLanguage();
  const [input, setInput] = useState('');
  const [sessionsOpen, setSessionsOpen] = useState(false);
  useEffect(() => { void chat.loadInitialSession(); }, [chat.loadInitialSession]);
  const send = async () => {
    const message = input.trim();
    if (!message || chat.loading) return;
    await chat.startStream({ message, session_id: chat.sessionId, ...(chat.selectedSkillIds ? { skills: chat.selectedSkillIds } : {}) }, { skillName: '移动问股' });
    setInput('');
  };
  return <section className="flex min-h-[calc(100dvh-9.5rem)] flex-col" aria-labelledby="mobile-chat-title">
    <header className="flex items-center justify-between"><div><p className="text-xs font-semibold tracking-[0.16em] text-cyan">AI CHAT</p><h1 id="mobile-chat-title" className="mt-1 text-2xl font-black">{t('mobile.chat.title')}</h1></div><div className="flex gap-1"><button type="button" aria-label="会话列表" onClick={() => setSessionsOpen(value => !value)} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><Menu className="h-4 w-4" /></button><button type="button" aria-label="新会话" onClick={chat.startNewChat} className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-border bg-card"><Plus className="h-4 w-4" /></button></div></header>
    {sessionsOpen ? <div className="mt-3 rounded-2xl border border-border bg-card p-2">{chat.sessions.map(session => <button key={session.session_id} type="button" onClick={() => void chat.switchSession(session.session_id)} className="min-h-11 w-full rounded-xl px-3 text-left text-sm">{session.title}</button>)}</div> : null}
    <div className="mt-4 flex-1 space-y-3">{chat.messages.length ? chat.messages.map(message => <div key={message.id} className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-cyan text-primary-foreground' : 'border border-border bg-card text-foreground'}`}>{message.content}</div>) : <div className="rounded-2xl border border-dashed border-border p-5 text-sm leading-6 text-muted-text">{t('mobile.chat.empty')}</div>}{chat.loading ? <p className="text-xs text-cyan">正在分析…</p> : null}{chat.chatError ? <p role="alert" className="text-xs text-danger">{chat.chatError.message}</p> : null}</div>
    <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-border bg-background/95 py-3 backdrop-blur"><label className="min-w-0 flex-1"><span className="sr-only">{t('mobile.chat.input')}</span><textarea aria-label={t('mobile.chat.input')} rows={1} value={input} onChange={event => setInput(event.target.value)} placeholder={t('mobile.chat.empty')} className="min-h-12 w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-cyan" /></label><button type="button" aria-label={t('mobile.chat.send')} disabled={!input.trim() || chat.loading} onClick={() => void send()} className="grid min-h-12 min-w-12 place-items-center rounded-2xl bg-cyan text-primary-foreground disabled:opacity-40"><Send className="h-5 w-5" /></button></div>
  </section>;
};
export default MobileChatPage;
