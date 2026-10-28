import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { loadLocalAiSettings } from '../data/ai-settings.js';
import { PageTitle } from '../components/PageTitle.jsx';

function readConversations(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved
      .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
      .map((item) => ({
        ...item,
        messages: Array.isArray(item.messages) ? item.messages.filter((message) => message
          && ['user', 'assistant'].includes(message.role)
          && typeof message.content === 'string'
          && message.content.trim()).slice(-200) : []
      })) : [];
  } catch {
    return [];
  }
}

export function AssistantPage({ user, t, onOpenSettings, toolsOpen, onToggleTools, language }) {
  const storageKey = `mini-finance.ai-conversations.v1${user?.id ? `.${user.id}` : '.anonymous'}`;
  const [storedConversations, setStoredConversations] = useState({ key: '', items: [] });
  const [selectedId, setSelectedId] = useState('');
  const [model, setModel] = useState(null);
  const [modelState, setModelState] = useState('loading');
  const [conversationsExpanded, setConversationsExpanded] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const messageAreaRef = useRef(null);

  useEffect(() => {
    const items = readConversations(storageKey);
    setStoredConversations({ key: storageKey, items });
    setSelectedId(items[0]?.id ?? '');
  }, [storageKey]);

  useEffect(() => {
    if (storedConversations.key === storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(storedConversations.items));
    }
  }, [storedConversations, storageKey]);

  useEffect(() => {
    let active = true;
    setModelState('loading');
    async function loadModel() {
      try {
        let config;
        let localKeys = {};
        if (user) config = (await apiRequest('/auth/ai-settings')).data;
        else {
          const local = await loadLocalAiSettings();
          config = local.settings;
          localKeys = local.apiKeys;
        }
        const assignedId = config.assignments?.conversation;
        const assigned = config.models?.find((entry) => entry.id === assignedId);
        const provider = config.providers?.find((item) => item.id === assigned?.providerId);
        const hasApiKey = user ? Boolean(provider?.hasApiKey) : Boolean(localKeys[provider?.id]);
        if (active) {
          setModel(assigned ? { ...assigned, provider, hasApiKey } : null);
          setModelState(assigned ? (hasApiKey ? 'ready' : 'missing-key') : 'unassigned');
        }
      } catch {
        if (active) {
          setModel(null);
          setModelState('unavailable');
        }
      }
    }
    loadModel();
    return () => { active = false; };
  }, [user?.id]);

  const conversations = storedConversations.key === storageKey ? storedConversations.items : [];
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);

  useEffect(() => {
    const area = messageAreaRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [selectedConversation?.id, selectedConversation?.messages?.length, sending]);

  function createConversation() {
    const conversation = { id: crypto.randomUUID(), title: t('newConversation'), createdAt: new Date().toISOString(), messages: [] };
    setStoredConversations((current) => ({ ...current, key: storageKey, items: [conversation, ...current.items] }));
    setSelectedId(conversation.id);
  }

  function deleteConversation(id) {
    if (!window.confirm(t('confirmDeleteConversation'))) return;
    const next = conversations.filter((item) => item.id !== id);
    setStoredConversations((current) => ({ ...current, key: storageKey, items: next }));
    if (selectedId === id) setSelectedId(next[0]?.id ?? '');
  }

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !user || !selectedConversation || sending || modelState !== 'ready') return;
    const conversationId = selectedConversation.id;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() };
    const pendingMessages = [...(selectedConversation.messages ?? []), userMessage];
    let contextLength = 0;
    const contextMessages = [];
    for (const message of pendingMessages.slice(-40).reverse()) {
      const remaining = 28000 - contextLength;
      if (remaining <= 0) break;
      const messageContent = message.content.slice(-Math.min(message.content.length, remaining));
      contextMessages.unshift({ role: message.role, content: messageContent });
      contextLength += messageContent.length;
    }
    setSendError('');
    setDraft('');
    setSending(true);
    setStoredConversations((current) => ({
      ...current,
      items: current.items.map((item) => item.id === conversationId ? { ...item, title: item.messages?.length ? item.title : content.slice(0, 48), messages: pendingMessages } : item)
    }));
    try {
      const { data } = await apiRequest('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: contextMessages })
      });
      const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', content: data.content, createdAt: new Date().toISOString() };
      setStoredConversations((current) => ({
        ...current,
        items: current.items.map((item) => item.id === conversationId ? { ...item, messages: [...(item.messages ?? []), assistantMessage] } : item)
      }));
    } catch (error) {
      setStoredConversations((current) => ({
        ...current,
        items: current.items.map((item) => item.id === conversationId ? { ...item, messages: (item.messages ?? []).filter((message) => message.id !== userMessage.id) } : item)
      }));
      setDraft(content);
      setSendError(error.code === 'UNAUTHENTICATED' ? 'assistantSignInRequired'
        : error.code === 'AI_CHAT_MODEL_UNASSIGNED' || error.code === 'AI_CHAT_MODEL_NOT_FOUND' ? 'assistantModelUnassigned'
          : error.code === 'AI_CHAT_KEY_MISSING' || error.code === 'AI_TEST_KEY_MISSING' ? 'assistantModelMissingKey'
            : error.code === 'AI_TEST_AUTH_FAILED' ? 'aiTestAuthFailed' : 'assistantSendFailed');
    } finally {
      setSending(false);
    }
  }

  return <section className="page-section assistant-page">
    <PageTitle title={t('assistant')} detail={t('assistantIntro')} />
    <div className={`assistant-workspace ${conversationsExpanded ? '' : 'conversations-collapsed'}`}>
      <aside className={`assistant-sidebar ${conversationsExpanded ? '' : 'collapsed'}`}>
        <div className="assistant-list-heading">
          <button className="assistant-sidebar-toggle" type="button" onClick={() => setConversationsExpanded((expanded) => !expanded)} aria-expanded={conversationsExpanded} aria-label={t(conversationsExpanded ? 'collapseConversations' : 'expandConversations')} title={t(conversationsExpanded ? 'collapseConversations' : 'expandConversations')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={conversationsExpanded ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} /></svg></button>
          {conversationsExpanded && <><div><span className="eyebrow">{t('assistant')}</span><h2>{t('conversations')}</h2></div><button className="assistant-new-button" type="button" onClick={createConversation} aria-label={t('newConversation')} title={t('newConversation')}>+</button></>}
        </div>
        {conversationsExpanded && <>
        <div className="assistant-conversation-list">
          {conversations.length ? conversations.map((conversation) => <div className={`assistant-conversation-item ${conversation.id === selectedId ? 'selected' : ''}`} key={conversation.id}>
            <button type="button" onClick={() => setSelectedId(conversation.id)} aria-current={conversation.id === selectedId ? 'page' : undefined}>
              <strong>{conversation.title}</strong><small>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }).format(new Date(conversation.createdAt))}</small>
            </button>
            <button className="assistant-delete-button" type="button" onClick={() => deleteConversation(conversation.id)} aria-label={t('deleteConversation')} title={t('deleteConversation')}>×</button>
          </div>) : <p className="assistant-list-empty">{t('noConversations')}</p>}
        </div>
        <button className={`assistant-tools-open ${toolsOpen ? 'selected' : ''}`} type="button" onClick={onToggleTools} aria-expanded={toolsOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg><span>{t('availableTools')}</span><svg className="assistant-tools-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d={toolsOpen ? 'm7 14 5-5 5 5' : 'm9 6 6 6-6 6'} /></svg></button>
        </>}
      </aside>

      <section className="assistant-chat" aria-label={t('assistantChat')}>
        <header className="assistant-chat-header">
          <div><div className="eyebrow">{t('assistantChat')}</div><h2>{selectedConversation?.title ?? t('newConversation')}</h2></div>
          <div className={`assistant-model-pill ${modelState}`}><span className="assistant-model-dot" /><span>{model ? `${model.customName || model.name}${modelState === 'missing-key' ? ` · ${t('assistantModelMissingKey')}` : ''}` : t(modelState === 'loading' ? 'assistantLoadingModel' : modelState === 'unavailable' ? 'assistantModelUnavailable' : 'assistantModelUnassigned')}</span></div>
        </header>

        <div className={`assistant-message-area ${selectedConversation?.messages?.length ? 'has-messages' : ''}`} ref={messageAreaRef} aria-live="polite">
          {selectedConversation?.messages?.length ? <div className="assistant-message-list">{selectedConversation.messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}><div>{message.content}</div></article>)}{sending && <article className="assistant-message assistant"><div className="assistant-typing-indicator"><i /><i /><i /></div></article>}</div> : <div className="assistant-empty-chat"><span className="assistant-mark" aria-hidden="true">m</span><h3>{selectedConversation ? t('conversationReady') : t('assistantWelcome')}</h3><p>{selectedConversation ? t('conversationReadyHint') : t('assistantWelcomeHint')}</p>{!selectedConversation && <button className="primary-button" type="button" onClick={createConversation}>{t('newConversation')}</button>}</div>}
        </div>

        <div className="assistant-composer-wrap">
          <label className="assistant-composer-label" htmlFor="assistant-composer">{t('messageComposer')}</label>
          {sendError && <p className="assistant-send-error" role="alert">{t(sendError)}</p>}
          <form className="assistant-composer" onSubmit={sendMessage}>
            <textarea id="assistant-composer" rows="2" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') sendMessage(event); }} disabled={!user || !selectedConversation || sending} placeholder={!user ? t('assistantSignInRequired') : !selectedConversation ? t('assistantCreateConversationHint') : t('assistantInputHint')} aria-describedby="assistant-status" maxLength={8000} />
            <button type="submit" className="assistant-send-button" disabled={!user || !selectedConversation || !draft.trim() || sending || modelState !== 'ready'} aria-label={t('sendMessage')} title={t('sendMessage')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4 16-4-6-8-2Z" /><path d="m12 14 8-10" /></svg></button>
          </form>
          <div className="assistant-composer-footer" id="assistant-status"><span>{!user ? t('assistantSignInRequired') : sending ? t('assistantSending') : modelState !== 'ready' ? t(modelState === 'missing-key' ? 'assistantModelMissingKey' : modelState === 'unassigned' ? 'assistantModelUnassigned' : 'assistantModelUnavailable') : t('assistantInputHint')}</span><button type="button" onClick={onOpenSettings}>{t('configureAi')}</button></div>
        </div>
      </section>
    </div>
  </section>;
}

export function AssistantToolsPanel({ t }) {
  return <section className="assistant-tools-panel" aria-label={t('availableTools')}>
    <header><div><span className="eyebrow">{t('assistant')}</span><h2>{t('availableTools')}</h2></div></header>
    <button className="assistant-tool-card" type="button" disabled title={t('toolComingSoon')}>
      <span className="assistant-tool-icon" aria-hidden="true">◷</span>
      <span className="assistant-tool-copy"><strong>{t('tokenAnalysisTool')}</strong><small>{t('toolComingSoon')}</small></span>
      <span className="assistant-tool-status">{t('toolPlanned')}</span>
    </button>
    <p className="assistant-tools-panel-note">{t('assistantToolsHint')}</p>
  </section>;
}
