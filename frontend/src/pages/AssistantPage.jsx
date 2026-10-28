import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { loadLocalAiSettings } from '../data/ai-settings.js';
import { PageTitle } from '../components/PageTitle.jsx';

function readConversations(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string') : [];
  } catch {
    return [];
  }
}

export function AssistantPage({ user, t, onOpenSettings }) {
  const storageKey = `mini-finance.ai-conversations.v1${user?.id ? `.${user.id}` : '.anonymous'}`;
  const [storedConversations, setStoredConversations] = useState({ key: '', items: [] });
  const [selectedId, setSelectedId] = useState('');
  const [model, setModel] = useState(null);
  const [modelState, setModelState] = useState('loading');

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

  return <section className="page-section assistant-page">
    <PageTitle title={t('assistant')} detail={t('assistantIntro')} />
    <div className="assistant-workspace">
      <aside className="assistant-sidebar">
        <div className="assistant-list-heading"><div><span className="eyebrow">{t('assistant')}</span><h2>{t('conversations')}</h2></div><button className="assistant-new-button" type="button" onClick={createConversation} aria-label={t('newConversation')} title={t('newConversation')}>+</button></div>
        <div className="assistant-conversation-list">
          {conversations.length ? conversations.map((conversation) => <div className={`assistant-conversation-item ${conversation.id === selectedId ? 'selected' : ''}`} key={conversation.id}>
            <button type="button" onClick={() => setSelectedId(conversation.id)} aria-current={conversation.id === selectedId ? 'page' : undefined}>
              <strong>{conversation.title}</strong><small>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(conversation.createdAt))}</small>
            </button>
            <button className="assistant-delete-button" type="button" onClick={() => deleteConversation(conversation.id)} aria-label={t('deleteConversation')} title={t('deleteConversation')}>×</button>
          </div>) : <p className="assistant-list-empty">{t('noConversations')}</p>}
        </div>
        <section className="assistant-tools">
          <div className="eyebrow">{t('availableTools')}</div>
          <div className="assistant-tool-empty"><span aria-hidden="true">◇</span><p>{t('noAvailableTools')}</p></div>
          <small>{t('assistantToolsHint')}</small>
        </section>
      </aside>

      <section className="assistant-chat" aria-label={t('assistantChat')}>
        <header className="assistant-chat-header">
          <div><div className="eyebrow">{t('assistantChat')}</div><h2>{selectedConversation?.title ?? t('newConversation')}</h2></div>
          <div className={`assistant-model-pill ${modelState}`}><span className="assistant-model-dot" /><span>{model ? `${model.customName || model.name}${modelState === 'missing-key' ? ` · ${t('assistantModelMissingKey')}` : ''}` : t(modelState === 'loading' ? 'assistantLoadingModel' : modelState === 'unavailable' ? 'assistantModelUnavailable' : 'assistantModelUnassigned')}</span></div>
        </header>

        <div className="assistant-message-area">
          {selectedConversation ? <div className="assistant-empty-chat"><span className="assistant-mark" aria-hidden="true">m</span><h3>{t('conversationReady')}</h3><p>{t('conversationReadyHint')}</p></div> : <div className="assistant-empty-chat"><span className="assistant-mark" aria-hidden="true">m</span><h3>{t('assistantWelcome')}</h3><p>{t('assistantWelcomeHint')}</p><button className="primary-button" type="button" onClick={createConversation}>{t('newConversation')}</button></div>}
        </div>

        <div className="assistant-composer-wrap">
          <label className="assistant-composer-label" htmlFor="assistant-composer">{t('messageComposer')}</label>
          <div className="assistant-composer">
            <textarea id="assistant-composer" rows="2" disabled placeholder={t('assistantComingSoon')} aria-describedby="assistant-status" />
            <button type="button" className="assistant-send-button" disabled aria-label={t('sendMessage')} title={t('sendMessage')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-4 16-4-6-8-2Z" /><path d="m12 14 8-10" /></svg></button>
          </div>
          <div className="assistant-composer-footer" id="assistant-status"><span>{t('assistantComingSoon')}</span><button type="button" onClick={onOpenSettings}>{t('configureAi')}</button></div>
        </div>
      </section>
    </div>
  </section>;
}
